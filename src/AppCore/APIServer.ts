/* Copyright Elysia © 2025. All rights reserved */

import { scope } from "electron-log";
import { app as electronApp } from "electron";
import express from "express";
import { readFileSync } from "fs";
import http from "http";
import https from "https";
import morgan from "morgan";
import { type AddressInfo } from "net";
import path from "path";
import { registerRoutesSync } from "src/AppUtils/RegisterRoutes";
import { ApexExperiment, GuildExperiment, UserExperiment } from "src/AppUtils/Experiments";
import Util from "src/AppUtils/Utils";

import Constants from "./Constants";

const logger = scope("APIServer");

const app = express();

app.use(express.json({ limit: "10mb" }));

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

app.post("/api/botclient/info", async (req, res) => {
    try {
        let token = (req.body.token || "").replace(/Bot/gi, "").trim();
        const response = await fetch("https://canary.discord.com/api/v9/applications/@me?with_counts=true", {
            headers: {
                Authorization: `Bot ${token}`,
                "User-Agent": Constants.UserAgentDiscordBot,
            },
        });
        if (!response.ok) throw new Error(response.statusText);
        const data = await response.json();
        const flags = data.flags || 0;
        const skipIntents: number[] = [];
        const GatewayIntentBits = { GuildPresences: 1 << 8, GuildMembers: 1 << 1, MessageContent: 1 << 15 };
        const AppFlags = {
            GatewayPresence: 1 << 12, GatewayPresenceLimited: 1 << 13,
            GatewayGuildMembers: 1 << 14, GatewayGuildMembersLimited: 1 << 15,
            GatewayMessageContent: 1 << 18, GatewayMessageContentLimited: 1 << 19,
        };
        if (!(flags & AppFlags.GatewayPresence) && !(flags & AppFlags.GatewayPresenceLimited)) {
            skipIntents.push(GatewayIntentBits.GuildPresences);
        }
        if (!(flags & AppFlags.GatewayGuildMembers) && !(flags & AppFlags.GatewayGuildMembersLimited)) {
            skipIntents.push(GatewayIntentBits.GuildMembers);
        }
        if (!(flags & AppFlags.GatewayMessageContent) && !(flags & AppFlags.GatewayMessageContentLimited)) {
            skipIntents.push(GatewayIntentBits.MessageContent);
        }
        let allIntents = 0;
        for (let i = 0; i < 22; i++) allIntents |= (1 << i);
        for (const intent of skipIntents) allIntents &= ~intent;
        res.json({
            success: true,
            data,
            intents: allIntents,
            allShards: Math.ceil((data.approximate_guild_count ?? 0) / 100) || 1,
        });
    } catch (e: any) {
        res.json({ success: false, message: e.message });
    }
});

app.get("/api/botclient/experiments/guild", (req, res) => {
    res.json(GuildExperiment());
});

app.post("/api/botclient/experiments/user", (req, res) => {
    const { allData, botId } = req.body;
    res.json(UserExperiment(allData || [], botId || ""));
});

app.post("/api/botclient/experiments/apex", (req, res) => {
    const { botId } = req.body;
    res.json(ApexExperiment(botId || ""));
});

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
        const appVersion = electronApp.getVersion();
        const appName = electronApp.getName();
        const defaultUserPatch = JSON.stringify(Constants.UserDefaultPatch);
        const vencordInjection = `
<script>
window.BotClientNative = {
    getBotInfo: function(token) {
        return fetch("/api/botclient/info", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: token })
        }).then(function(r) { return r.json(); });
    },
    getBotClientVersion: function() { return "${appVersion}"; },
    getBotClientName: function() { return "${appName}"; },
    getPrivateChannelDefault: function() {
        return {
            type: 1,
            recipients: [${defaultUserPatch}],
            last_message_id: "1000000000000000000",
            is_spam: false,
            id: "1000000000000000000",
            flags: 0,
        };
    },
    getUserExperiments: function(allData, botId) {
        var xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/botclient/experiments/user", false);
        xhr.setRequestHeader("Content-Type", "application/json");
        xhr.send(JSON.stringify({ allData: allData, botId: botId }));
        return JSON.parse(xhr.responseText);
    },
    getGuildExperiments: function() {
        var xhr = new XMLHttpRequest();
        xhr.open("GET", "/api/botclient/experiments/guild", false);
        xhr.send();
        return JSON.parse(xhr.responseText);
    },
    getApexExperiments: function(botId) {
        var xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/botclient/experiments/apex", false);
        xhr.setRequestHeader("Content-Type", "application/json");
        xhr.send(JSON.stringify({ botId: botId }));
        return JSON.parse(xhr.responseText);
    },
    close: function() {},
    minimize: function() {},
    maximize: function() {},
    focus: function() {},
    flashFrame: function() {},
};
window.protoAPI = {
    GetPreloadedUserSettings: function() {},
    GetPreloadedUserSettingsResponse: function() {},
    SetPreloadedUserSettings: function() {},
    GetFrecencyUserSettings: function() {},
    GetFrecencyUserSettingsResponse: function() {},
    SetFrecencyUserSettings: function() {},
};
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
