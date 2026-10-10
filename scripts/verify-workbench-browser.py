"""Exercise the real local MCP/AG-UI/A2UI integration, without request mocks.

Requirements: an installed Python Playwright package and an installed Chromium
browser. Run against the already-started demo; no model, payment or external
business service is used. Browser profiles are ephemeral.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import expect, sync_playwright


DEMO = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--base-url", default="http://127.0.0.1:3210")
parser.add_argument("--browser", default=os.environ.get(
    "DEMO_BROWSER", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"))
parser.add_argument("--output", type=Path, default=DEMO / "workbench-browser-results.json")
parser.add_argument("--screenshots", type=Path, default=DEMO / "browser-artifacts")
parser.add_argument("--widths", default="375,1100")
parser.add_argument("--routes", default="workbench,a2ui-over-mcp,a2ui-in-app")
parser.add_argument("--skip-legacy", action="store_true")


def decode_body(body):
    try:
        return json.loads(body)
    except (ValueError, TypeError):
        return body


class Trace:
    def __init__(self, page):
        self.calls = []
        self.errors = []
        self.console_errors = []
        self.failed_requests = []
        self.resource_errors = []
        page.on("pageerror", lambda error: self.errors.append(str(error)))
        page.on("console", lambda message: self.console_errors.append(message.text)
                if message.type == "error" else None)
        page.on("requestfailed", lambda request: self.failed_requests.append({
            "url": request.url, "failure": request.failure}))
        page.on("requestfinished", self.record)
        page.on("response", lambda response: self.resource_errors.append({
            "url": response.url, "status": response.status}) if response.status >= 400 else None)

    def record(self, request):
        if "/api/" not in request.url:
            return
        response = request.response()
        output = decode_body(response.text())
        if isinstance(output, dict) and isinstance(output.get("html"), str):
            output = {key: value for key, value in output.items() if key != "html"} | {
                "bundled_html_bytes": len(output["html"].encode("utf-8"))}
        self.calls.append({
            "path": urlparse(request.url).path,
            "method": request.method,
            "input": decode_body(request.post_data),
            "status": response.status,
            "output": output,
        })

    def tool_calls(self, name=None):
        return [call for call in self.calls
                if call["path"] == "/api/workbench/call"
                and (name is None or call["input"].get("name") == name)]


def frame_inside(page, selector):
    outer = page.locator(selector)
    expect(outer).to_have_count(1)
    proxy = outer.element_handle().content_frame()
    assert proxy is not None, "sandbox proxy frame is missing"
    expect(proxy.locator("iframe")).to_have_count(1, timeout=20000)
    app = proxy.locator("iframe").element_handle().content_frame()
    assert app is not None, "isolated App iframe is missing"
    return proxy, app


def assert_isolated(proxy, app):
    assert urlparse(proxy.url).port != urlparse(proxy.page.url).port
    assert app.evaluate("""() => {
      try { void window.parent.document.body; return false; }
      catch (_) { return true; }
    }"""), "App must not access its parent DOM"
    assert proxy.locator("iframe").get_attribute("sandbox") == "allow-scripts"


def settle_frame_layout(page):
    """Wait for asynchronous App size notifications before pointer interaction."""
    previous = None
    steady = 0
    for _ in range(30):
        dimensions = []
        for frame in page.frames:
            dimensions.append(frame.evaluate("""() => [innerWidth, innerHeight,
                document.documentElement.scrollWidth, document.documentElement.scrollHeight]"""))
        if dimensions == previous:
            steady += 1
            if steady >= 4:
                return
        else:
            steady = 0
        previous = dimensions
        page.wait_for_timeout(100)
    raise AssertionError(f"frame sizing did not settle: {previous}")


def click_centered(locator):
    # A partly visible control at the very bottom of a nested iframe can be
    # missed by Chromium's pointer dispatch. Scroll the host to expose the
    # control centrally, then use an actual pointer click (never el.click()).
    locator.scroll_into_view_if_needed()
    box = locator.bounding_box()
    assert box is not None
    locator.page.evaluate("y => window.scrollBy(0, y - innerHeight / 2)",
                          box["y"] + box["height"] / 2)
    locator.click()


def assert_no_overflow(page):
    rows = []
    for frame in page.frames:
        row = frame.evaluate("""() => ({
          viewport: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          bodyWidth: document.body ? document.body.scrollWidth : 0,
          url: location.href
        })""")
        assert row["scrollWidth"] <= row["viewport"] + 1, row
        assert row["bodyWidth"] <= row["viewport"] + 1, row
        rows.append(row)
    return rows


def page_task_id(page):
    value = parse_qs(urlparse(page.url).query).get("taskId", [None])[0]
    assert value, f"taskId must be persisted in the URL: {page.url}"
    return value


def assert_clean_trace(trace):
    assert not trace.errors, trace.errors
    assert not trace.failed_requests, trace.failed_requests
    assert all(call["status"] < 400 for call in trace.calls), trace.calls


def receipt_from(call):
    output = call["output"]
    assert isinstance(output, dict), output
    assert not output.get("isError"), output
    return output.get("structuredContent", output)


def screenshot(page, path):
    viewport = page.viewport_size
    try:
        # Chrome may omit offscreen cross-origin iframe compositor layers from
        # full-page screenshots. Expose the full document temporarily; width
        # stays fixed, and the test viewport is restored before assertions.
        height = page.evaluate("document.documentElement.scrollHeight")
        if viewport:
            page.set_viewport_size({"width": viewport["width"], "height": min(6000, max(height, viewport["height"]))})
        page.evaluate("window.scrollTo(0, 0)")
        page.wait_for_timeout(200)
        page.screenshot(path=str(path), full_page=True, animations="disabled")
    finally:
        if viewport:
            page.set_viewport_size(viewport)


def agui_events(trace):
    events = []
    for call in trace.calls:
        if call["path"] != "/api/workbench/run" or not isinstance(call["output"], str):
            continue
        batch = [json.loads(line[5:].strip()) for line in call["output"].splitlines()
                 if line.startswith("data:")]
        assert batch[0]["type"] == "RUN_STARTED", batch
        assert batch[-1]["type"] == "RUN_FINISHED", batch
        activity = [event for event in batch if event["type"] == "ACTIVITY_SNAPSHOT"]
        assert activity and all(event["activityType"] == "a2ui-surface" for event in activity)
        assert any("updateDataModel" in operation for event in activity
                   for operation in event["content"]["a2ui_operations"])
        events.extend(batch)
    return events


def verify_composed_workbench(page, trace, base, screenshots, width):
    page.goto(f"{base}/workbench", wait_until="load")
    surface = page.locator("#surface")
    confirm = surface.locator('[data-component-id="confirm"]')
    cancel = surface.locator('[data-component-id="cancel"]')
    summary = surface.locator('[data-component-id="pickup-summary"]')
    receipt = surface.locator('[data-component-id="receipt-label"]')
    expect(confirm).to_be_disabled(timeout=20000)
    expect(cancel).to_be_enabled()
    expect(summary).to_have_text("尚未保存取件安排")
    expect(surface).to_contain_text("Mac mini")
    expect(surface).to_contain_text("4,499.00")
    initial_task = page_task_id(page)
    proxy, app = frame_inside(page, "#pickup-sandbox")
    assert_isolated(proxy, app)
    expect(app.locator('[data-slot-id="tomorrow-pm"]')).to_be_enabled(timeout=20000)
    settle_frame_layout(page)
    assert page.locator('[data-component-type="MCPApp"]').count() == 1
    assert app.locator('[data-component-id]').count() == 0, "pickup App is ordinary HTML, not an A2UI renderer"
    expected_label = "明天 14:00–18:00"
    app.locator('[data-slot-id="tomorrow-pm"]').check()
    expect(confirm).to_be_disabled()
    expect(summary).to_have_text("尚未保存取件安排")
    assert len(trace.tool_calls("save_pickup")) == 0
    click_centered(app.locator("#save-pickup"))
    expect(confirm).to_be_enabled(timeout=20000)
    expect(summary).to_have_text(expected_label)
    expect(app.locator("#pickup-status")).to_contain_text("已保存")
    calls = trace.tool_calls("save_pickup")
    assert len(calls) == 1, calls
    task = receipt_from(calls[-1])["task"]
    assert task["taskId"] == initial_task
    assert task["status"] == "awaiting_confirmation" and "refund" not in task
    assert task["version"] == 2 == task["pickup"]["version"]
    assert task["pickup"]["slotId"] == "tomorrow-pm"
    expect(receipt).to_contain_text(task["pickup"]["arrangementId"])
    expect(receipt).to_contain_text("v2")
    expect(app.locator("#pickup-arrangement")).to_contain_text(task["pickup"]["arrangementId"])
    expect(app.locator("#pickup-version")).to_contain_text("v2")
    assert not app.is_detached(), "updating outer A2UI must not restart the App iframe"
    assert len([c for c in trace.calls if c["path"] == "/api/workbench/bootstrap"]) == 1
    snapshots = [event["snapshot"] for event in agui_events(trace) if event["type"] == "STATE_SNAPSHOT"]
    assert any(snapshot.get("pickup", {}).get("arrangementId") == task["pickup"]["arrangementId"]
               and snapshot["version"] == 2 for snapshot in snapshots)
    screenshot(page, screenshots / f"workbench-saved-{width}.png")
    saved_layout = assert_no_overflow(page)

    # A different local selection is only a draft; restoring cannot save it.
    app.locator('[data-slot-id="day-after-am"]').check()
    expect(summary).to_have_text(expected_label)
    assert len(trace.tool_calls("save_pickup")) == 1
    page.reload(wait_until="load")
    expect(summary).to_have_text(expected_label, timeout=20000)
    expect(confirm).to_be_enabled()
    assert page_task_id(page) == initial_task
    proxy, app = frame_inside(page, "#pickup-sandbox")
    expect(app.locator('[data-slot-id="tomorrow-pm"]')).to_be_checked(timeout=20000)
    expect(app.locator("#pickup-arrangement")).to_contain_text(task["pickup"]["arrangementId"])
    assert len(trace.tool_calls("save_pickup")) == 1, "reload must only read, not repeat save"

    click_centered(confirm)
    expect(surface.locator('[data-component-id="result-title"]')).to_contain_text("申请已提交", timeout=20000)
    request_id = surface.locator('[data-component-id="request-id"]').inner_text()
    assert "RF-" in request_id
    expect(surface).to_contain_text("尚未到账")
    expect(page.locator("#pickup-sandbox")).to_have_count(0)
    page.reload(wait_until="load")
    expect(surface.locator('[data-component-id="request-id"]')).to_have_text(request_id, timeout=20000)
    assert page_task_id(page) == initial_task
    screenshot(page, screenshots / f"workbench-confirmed-{width}.png")

    page.locator("#new-task").click()
    expect(summary).to_have_text("尚未保存取件安排", timeout=20000)
    expect(confirm).to_be_disabled()
    assert page_task_id(page) != initial_task
    cancelled_task = page_task_id(page)
    _, new_app = frame_inside(page, "#pickup-sandbox")
    expect(new_app.locator('[data-slot-id="tomorrow-pm"]')).to_be_enabled(timeout=20000)
    click_centered(cancel)
    expect(surface.locator('[data-component-id="result-title"]')).to_contain_text("已取消", timeout=20000)
    assert "RF-" not in surface.inner_text()
    page.reload(wait_until="load")
    expect(surface.locator('[data-component-id="result-title"]')).to_contain_text("已取消", timeout=20000)
    assert page_task_id(page) == cancelled_task
    assert_clean_trace(trace)
    return {
        "pattern": "A2UI contains MCP App, delivered over AG-UI",
        "real_mcp_bridge": True, "double_iframe_isolated": True,
        "host_a2ui_components": True, "app_a2ui_components": False,
        "local_draft_does_not_mutate_outer_card": True,
        "real_save_receipt_synchronizes_outer_version": 2,
        "save_is_not_refund": True, "keyed_iframe_preserved": True,
        "reload_restores_without_repeating_write": True,
        "confirmed_and_cancelled": True, "new_task": True,
        "agui_event_types": sorted({event["type"] for event in agui_events(trace)}),
        "layout": saved_layout,
    }


def verify_mcp_patterns(page, trace, base, route, screenshots, width):
    inside = route == "a2ui-in-app"
    page.goto(f"{base}/{route}", wait_until="load")

    def renderer_frame():
        if inside:
            proxy, app = frame_inside(page, "#workbench-sandbox")
            assert_isolated(proxy, app)
            assert page.locator("[data-component-id]").count() == 0
            return app
        expect(page.locator("iframe")).to_have_count(0)
        return page.main_frame

    frame = renderer_frame()
    confirm = frame.locator('[data-component-id="confirm"]')
    expect(confirm).to_be_disabled(timeout=20000)
    expect(frame.locator('[data-component-id="cancel"]')).to_be_enabled()
    expect(frame.locator("#local-slot")).to_be_enabled()
    settle_frame_layout(page)
    summary = frame.locator('[data-component-id="pickup-summary"]')
    expect(summary).to_have_text("尚未保存取件安排")
    initial_task = page_task_id(page)
    initial_component_count = frame.locator("[data-component-id]").count()
    assert initial_component_count > 20
    frame.locator("#local-slot").select_option("tomorrow-am")
    expect(summary).to_have_text("尚未保存取件安排")
    expect(confirm).to_be_disabled()
    assert not trace.tool_calls("save_pickup")
    click_centered(frame.locator("#save-local-pickup"))
    expect(confirm).to_be_enabled(timeout=20000)
    expect(summary).to_have_text("明天 09:00–12:00")
    calls = trace.tool_calls("save_pickup")
    assert len(calls) == 1
    task = receipt_from(calls[-1])["task"]
    assert task["taskId"] == initial_task
    assert task["status"] == "awaiting_confirmation" and "refund" not in task
    assert task["version"] == 2 == task["pickup"]["version"]
    expect(frame.locator('[data-component-id="receipt-label"]')).to_contain_text(task["pickup"]["arrangementId"])
    expect(page.locator("#task-meta")).to_have_attribute("data-version", "2")
    descriptions = trace.tool_calls("review_workbench_a2ui")
    assert descriptions
    assert any(item.get("type") == "resource" and
               item.get("resource", {}).get("mimeType") == "application/a2ui+json"
               for item in descriptions[-1]["output"]["content"])
    assert not any(call["path"] == "/api/workbench/run" for call in trace.calls), "these MCP patterns do not require AG-UI"
    screenshot(page, screenshots / f"{route}-saved-{width}.png")
    saved_layout = assert_no_overflow(page)

    page.reload(wait_until="load")
    frame = renderer_frame()
    expect(frame.locator('[data-component-id="pickup-summary"]')).to_have_text("明天 09:00–12:00", timeout=20000)
    expect(frame.locator('[data-component-id="confirm"]')).to_be_enabled()
    settle_frame_layout(page)
    assert page_task_id(page) == initial_task
    assert len(trace.tool_calls("save_pickup")) == 1
    click_centered(frame.locator('[data-component-id="confirm"]'))
    expect(frame.locator('[data-component-id="result-title"]')).to_contain_text("申请已提交", timeout=20000)
    request_id = frame.locator('[data-component-id="request-id"]').inner_text()
    assert "RF-" in request_id
    expect(frame.locator('[data-component-id="result-message"]')).to_contain_text("尚未到账")
    expect(frame.locator("#save-local-pickup")).to_be_disabled()
    page.reload(wait_until="load")
    frame = renderer_frame()
    expect(frame.locator('[data-component-id="request-id"]')).to_have_text(request_id, timeout=20000)
    assert page_task_id(page) == initial_task
    assert len(trace.tool_calls("decide_workbench")) == 1, "reload must not repeat refund"

    page.locator("#new-task").click()
    frame = renderer_frame()
    expect(frame.locator('[data-component-id="pickup-summary"]')).to_have_text("尚未保存取件安排", timeout=20000)
    expect(frame.locator('[data-component-id="confirm"]')).to_be_disabled()
    assert page_task_id(page) != initial_task
    cancelled_task = page_task_id(page)
    click_centered(frame.locator('[data-component-id="cancel"]'))
    expect(frame.locator('[data-component-id="result-title"]')).to_contain_text("已取消", timeout=20000)
    assert frame.locator('[data-component-id="request-id"]').count() == 0
    page.reload(wait_until="load")
    frame = renderer_frame()
    expect(frame.locator('[data-component-id="result-title"]')).to_contain_text("已取消", timeout=20000)
    assert page_task_id(page) == cancelled_task
    assert_clean_trace(trace)
    return {
        "pattern": "A2UI inside MCP App" if inside else "A2UI over MCP without Apps",
        "real_mcp_bridge": inside, "double_iframe_isolated": inside,
        "host_a2ui_components": 0 if inside else initial_component_count,
        "app_a2ui_components": initial_component_count if inside else 0,
        "application_a2ui_json_resource_verified": True,
        "local_draft_does_not_mutate_summary": True,
        "save_is_not_refund": True,
        "real_save_receipt_synchronizes_outer_version": 2,
        "reload_restores_without_repeating_write": True,
        "confirmed_and_cancelled": True, "new_task": True,
        "layout": saved_layout,
    }


def verify_version_conflict(page, trace, base, screenshots, width):
    page.goto(f"{base}/workbench", wait_until="load")
    expect(page.locator('#surface [data-component-id="cancel"]')).to_be_enabled(timeout=20000)
    original_task = page_task_id(page)
    _, app_one = frame_inside(page, "#pickup-sandbox")
    expect(app_one.locator('[data-slot-id="tomorrow-am"]')).to_be_enabled(timeout=20000)
    second = page.context.new_page()
    second_trace = Trace(second)
    try:
        second.goto(f"{base}/workbench?taskId={original_task}", wait_until="load")
        _, app_two = frame_inside(second, "#pickup-sandbox")
        expect(app_two.locator('[data-slot-id="tomorrow-pm"]')).to_be_enabled(timeout=20000)
        expect(app_one.locator("#pickup-version")).to_contain_text("v1")
        expect(app_two.locator("#pickup-version")).to_contain_text("v1")
        settle_frame_layout(page)
        settle_frame_layout(second)

        app_one.locator('[data-slot-id="tomorrow-am"]').check()
        click_centered(app_one.locator("#save-pickup"))
        expect(page.locator('#surface [data-component-id="pickup-summary"]')).to_have_text("明天 09:00–12:00", timeout=20000)
        expect(app_one.locator("#pickup-version")).to_contain_text("v2")

        app_two.locator('[data-slot-id="tomorrow-pm"]').check()
        click_centered(app_two.locator("#save-pickup"))
        expect(app_two.locator("#pickup-status")).to_have_attribute("data-state", "error", timeout=20000)
        expect(app_two.locator("#pickup-status")).to_contain_text("版本")
        expect(app_two.locator('[data-slot-id="tomorrow-pm"]')).to_be_checked()
        expect(app_two.locator("#save-pickup")).to_be_enabled()
        expect(second.locator('#surface [data-component-id="pickup-summary"]')).to_have_text("尚未保存取件安排")
        failed = second_trace.tool_calls("save_pickup")[-1]
        assert failed["input"]["arguments"]["version"] == 1
        assert failed["output"]["isError"] is True
        assert failed["output"]["structuredContent"]["error"]["code"] == 409
        screenshot(second, screenshots / f"workbench-version-conflict-{width}.png")

        second.locator("#resume-task").click()
        expect(second.locator('#surface [data-component-id="pickup-summary"]')).to_have_text("明天 09:00–12:00", timeout=20000)
        _, app_two = frame_inside(second, "#pickup-sandbox")
        expect(app_two.locator("#pickup-version")).to_contain_text("v2", timeout=20000)
        settle_frame_layout(second)
        app_two.locator('[data-slot-id="tomorrow-pm"]').check()
        click_centered(app_two.locator("#save-pickup"))
        expect(second.locator('#surface [data-component-id="pickup-summary"]')).to_have_text("明天 14:00–18:00", timeout=20000)
        expect(app_two.locator("#pickup-version")).to_contain_text("v3")
        saved = receipt_from(second_trace.tool_calls("save_pickup")[-1])["task"]
        assert saved["version"] == saved["pickup"]["version"] == 3
        assert "refund" not in saved

        page.locator("#resume-task").click()
        expect(page.locator('#surface [data-component-id="pickup-summary"]')).to_have_text("明天 14:00–18:00", timeout=20000)
        expect(page.locator("#task-meta")).to_have_attribute("data-version", "3")
        assert_clean_trace(trace)
        assert_clean_trace(second_trace)
        return {
            "two_real_browser_tabs": True,
            "stale_version_rejected_by_real_mcp_tool": 409,
            "failed_draft_preserved": True,
            "recovery_then_save_version": 3,
            "refund_not_submitted": True,
            "second_tab_requests": second_trace.calls,
        }
    finally:
        second.close()


def verify_legacy(page, trace, base, route, decision):
    page.goto(f"{base}/{route}", wait_until="load")
    frame = page.main_frame
    isolated = False
    if route == "mcp-apps":
        expect(page.locator("#status")).to_contain_text("App 已初始化", timeout=20000)
        proxy, frame = frame_inside(page, "#sandbox")
        assert_isolated(proxy, frame)
        isolated = True
    confirm = frame.locator(".refund-actions button.primary")
    cancel = frame.locator(".refund-actions button.secondary")
    expect(confirm).to_be_enabled(timeout=15000)
    expect(cancel).to_be_enabled()
    settle_frame_layout(page)
    card = frame.locator(".refund-card")
    expect(card).to_contain_text("Mac mini")
    expect(card).to_contain_text("4,499.00")
    image = frame.locator("img").first
    expect(image).to_have_js_property("complete", True)
    expect(image).not_to_have_js_property("naturalWidth", 0)
    click_centered(confirm if decision == "confirm" else cancel)
    expect(frame.locator(".refund-result-title")).to_contain_text(
        "申请已提交" if decision == "confirm" else "已取消", timeout=15000)
    expect(frame.locator(".refund-actions")).not_to_be_visible()
    if decision == "confirm":
        expect(card).to_contain_text("RF-")
    else:
        assert "RF-" not in card.inner_text()
    assert_clean_trace(trace)
    return {"order_image_loaded": True, "real_mcp_bridge": isolated,
            "decision": decision, "layout": assert_no_overflow(page)}


def main():
    args = parser.parse_args()
    base = args.base_url.rstrip("/")
    parsed = urlparse(base)
    if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost"}:
        parser.error("Only a loopback HTTP demo server is allowed.")
    args.screenshots.mkdir(parents=True, exist_ok=True)
    results = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=args.browser, headless=True)
        browser_version = browser.version
        for width in [int(value) for value in args.widths.split(",")]:
            cases = [(route, None) for route in args.routes.split(",") if route]
            if "workbench" in args.routes.split(","):
                cases.append(("version-conflict", None))
            if not args.skip_legacy:
                cases += [(route, decision) for route in ("ag-ui", "a2ui", "mcp-apps")
                          for decision in ("confirm", "cancel")]
            for route, decision in cases:
                label = f"{route}-{decision or 'full-flow'}-{width}"
                print(f"验证 {label}", flush=True)
                context = browser.new_context(viewport={"width": width, "height": 1050})
                page = context.new_page()
                page.set_default_timeout(15000)
                trace = Trace(page)
                result = {"case": label, "route": route, "width": width}
                try:
                    if route == "workbench":
                        details = verify_composed_workbench(page, trace, base, args.screenshots, width)
                    elif route in ("a2ui-over-mcp", "a2ui-in-app"):
                        details = verify_mcp_patterns(page, trace, base, route, args.screenshots, width)
                    elif route == "version-conflict":
                        details = verify_version_conflict(page, trace, base, args.screenshots, width)
                    else:
                        details = verify_legacy(page, trace, base, route, decision)
                    result.update({"passed": True, **details})
                except Exception as error:
                    result.update({"passed": False, "error": f"{type(error).__name__}: {error}"})
                    try:
                        screenshot(page, args.screenshots / f"FAILED-{label}.png")
                    except Exception:
                        pass
                    print(result["error"], flush=True)
                result["unhandled_errors"] = trace.errors
                result["console_errors"] = trace.console_errors
                result["failed_requests"] = trace.failed_requests
                result["resource_errors"] = trace.resource_errors
                result["requests"] = trace.calls
                results.append(result)
                context.close()
        browser.close()
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "base_url": base, "browser": browser_version,
        "request_mocking": False, "business_state_injection": False,
        "environment": "local deterministic simulation, no real payments or logistics",
        "passed": sum(result["passed"] for result in results),
        "failed": sum(not result["passed"] for result in results),
        "total": len(results), "cases": results,
    }
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({key: report[key] for key in ("passed", "failed", "total")}, ensure_ascii=False))
    print(f"报告：{args.output}")
    return 1 if report["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
