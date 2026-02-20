/* Copyright Elysia © 2025. All rights reserved */

import { scope } from "electron-log";
import express from "express";
import { readFileSync } from "fs";
import http from "http";
import https from "https";
import morgan from "morgan";
import { type AddressInfo } from "net";
import path from "path";
import { registerRoutesSync } from "src/AppUtils/RegisterRoutes";
import Util from "src/AppUtils/Utils";

import Constants from "./Constants";

const logger = scope("APIServer");

const app = express();

if (Constants.VerboseAPIServerLogging) { app.use(
    morgan("dev", {
        stream: {
            write: msg => logger.info(msg.replace(/\n/g, "")),
        },
    }),
); }

const server = https.createServer(Constants.HttpsOptions, app);

const ignoreHeaders = ["cookie", "sec-", "referer", "origin", "authorization", "host"];

// Handle headers
app.all("*", function (req, res, next) {
    req.originalHeaders = req.headers;
    const headers: typeof req.headers = {};
    Object.keys(req.headers).forEach(key => {
        if (!ignoreHeaders.some(prefix => key.toLowerCase().startsWith(prefix))) {
            headers[key] = req.headers[key];
        }
    });
    if (req.headers.authorization) {
        if (!req.headers.authorization.toLowerCase().startsWith("bot ")) {
            headers.authorization = `Bot ${req.headers.authorization.trim()}`;
        } else {
            headers.authorization = req.headers.authorization.trim();
        }
        headers["user-agent"] = Constants.UserAgentDiscordBot;
    }
    req.headers = headers;
    next();
});

registerRoutesSync(app, path.resolve(__dirname, "routes"), ["/api/v10", "/api/v9", "/api"]);

app.use("/vencord", express.static(Constants.VencordExtensionPath));

app.all("/developers/*", (req, res) => {
    return res.redirect("/app");
});

// Other
app.use((req, res, next) => {
    if (req.originalUrl.endsWith(".map")) return res.status(404).send();
    if (Constants.BlacklistRoutes.some(_ => req.originalUrl.includes(_))) {
        return res.status(403).send({
            message: "APIServer: Bots cannot use this endpoint",
            code: 20001,
        });
    }
    // API routes
    if (req.originalUrl.includes("/api/")) return Util.proxy(req, res);
    // Main page
    if (["/", "/app", "/login"].includes(req.path) || ["/channels/"].some(s => req.path.startsWith(s))) {
        logger.log("Serving Discord HTML for route:", req.path);
        let html = readFileSync(Constants.DiscordHTMLPath, "utf8");
        const vencordInjection = `
<script>
document.addEventListener("DOMContentLoaded", () => {
    window.postMessage({
        type: "vencord:meta",
        meta: {
            EXTENSION_VERSION: "1.14.2",
            EXTENSION_BASE_URL: "/vencord/",
            RENDERER_CSS_URL: "/vencord/dist/Vencord.css",
        }
    });
}, { once: true });
</script>
<script src="/vencord/dist/Vencord.js"></script>
<link href="/vencord/dist/Vencord.css" rel="stylesheet">`;
        html = html.replace("</head>", vencordInjection + "\n</head>");
        return res.send(html);
    }
    // Other routes
    req.headers = req.originalHeaders;
    return Util.proxy(req, res);
});

export default async function start (): Promise<number> {
    const httpServer = http.createServer(app);
    httpServer.listen(5000, "0.0.0.0", () => {
        logger.log("HTTP Server listening on http://0.0.0.0:5000");
    });

    return new Promise((resolve, reject) => {
        const callback = () => {
            const address = server.address() as AddressInfo;
            resolve(address.port);
            logger.log(`API Server listening on https://localhost:${address.port}`);
        };
        server.listen(0).once("listening", callback);
    });
}
