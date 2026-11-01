import { httpRouter } from "convex/server";
import { webhook } from "./emails.js";

const http = httpRouter();
http.route({ path: "/plunk-webhook", method: "POST", handler: webhook });
export default http;
