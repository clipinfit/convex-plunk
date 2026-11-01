import { defineApp } from "convex/server";
import plunk from "../../convex-plunk/src/component/convex.config.js";

const app = defineApp();
app.use(plunk);
export default app;
