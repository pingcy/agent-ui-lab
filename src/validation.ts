import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";

const read = (name: string) => JSON.parse(readFileSync(new URL(`../schemas/${name}`, import.meta.url), "utf8"));
const ajv = new Ajv2020({ strict: false, allErrors: true });
ajv.addFormat("date-time", { type: "string", validate: (value: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(Date.parse(value)) });
ajv.addFormat("uri", { type: "string", validate: (value: string) => { try { new URL(value); return true; } catch { return false; } } });
ajv.addSchema(read("common_types.json"));
ajv.addSchema(read("refund-catalog.json"), "https://a2ui.org/specification/v0_9/catalog.json");
export const validateServerMessage = ajv.compile(read("server_to_client.json"));
export const validateClientMessage = ajv.compile(read("client_to_server.json"));
