const express = require("express");
const app = express();
const { MongoClient } = require("mongodb");
const sanitizeHtml = require("sanitize-html");
const multer = require("multer");

app.use(express.json({ limit: "4mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

const upload = multer({ limits: { fileSize: 3 * 1024 * 1024 } });

const MONGO_URL = process.env.MONGO_URL;
let db;

// --- XSS & 暴言フィルタ ----------------------------------
function badWords(text) {
  const ng = ["死ね", "殺す", "<script", "javascript:"];
  return ng.some((w) => text.includes(w));
}

function safe(text) {
  return sanitizeHtml(text, {
    allowedTags: [
      "b",
      "i",
      "u",
      "strong",
      "em",
      "p",
      "br",
      "ul",
      "ol",
      "li",
      "span",
      "h1",
      "h2",
      "h3",
      "small",
      "big",
    ],
    allowedAttributes: {
      span: ["style"],
      p: ["style"],
      h1: ["style"],
      h2: ["style"],
      h3: ["style"],
    },
  });
}

// --- DB 接続 --------------------------------------------
MongoClient.connect(MONGO_URL).then((client) => {
  db = client.db("wiki");
  console.log("MongoDB connected");
});

// --- ページ取得 -----------------------------------------
app.get("/api/page/:title", async (req, res) => {
  const p = await db.collection("pages").findOne({ title: req.params.title });
  if (!p)
    return res.json({
      title: req.params.title,
      content: "（まだページがありません）",
    });
  res.json(p);
});

// --- ページ一覧 ------------------------------------------
app.get("/api/pages", async (req, res) => {
  const list = await db
    .collection("pages")
    .find()
    .project({ title: 1 })
    .toArray();
  res.json(list);
});

// --- ユーザー一覧 ----------------------------------------
app.get("/api/users", async (req, res) => {
  const users = await db.collection("users").find().toArray();
  res.json(users);
});

// --- アイコンアップロード --------------------------------
app.post("/api/icon", upload.single("icon"), async (req, res) => {
  const ip = req.ip;
  if (!req.file) return res.json({ error: "ファイルが必要です" });

  const base64 = "data:image/png;base64," + req.file.buffer.toString("base64");

  await db
    .collection("users")
    .updateOne(
      { name: ip },
      { $set: { name: ip, icon: base64 } },
      { upsert: true }
    );

  res.json({ ok: true });
});

// --- 保存（履歴つき） ------------------------------------
app.post("/api/save", async (req, res) => {
  const { title, raw } = req.body;
  const ip = req.ip;

  if (badWords(raw)) return res.json({ error: "禁止ワードが含まれています" });

  const clean = safe(raw);

  await db.collection("pages").updateOne(
    { title },
    {
      $set: { title, content: clean },
      $push: {
        history: {
          time: Date.now(),
          ip: ip,
          masked: ip.replace(/(\\d+\\.\\d+\\.)(\\d+\\.\\d+)/, "$1***.***"),
          raw: clean,
        },
      },
    },
    { upsert: true }
  );

  res.json({ ok: true });
});

// --- 履歴取得 --------------------------------------------
app.get("/api/history/:title", async (req, res) => {
  const p = await db.collection("pages").findOne({ title: req.params.title });
  res.json(p?.history || []);
});

// --- 2日以内復元 -----------------------------------------
app.post("/api/restore", async (req, res) => {
  const { title, time } = req.body;

  const p = await db.collection("pages").findOne({ title });
  if (!p) return res.json({ error: "ページがない" });

  const h = p.history.find((x) => x.time === time);
  if (!h) return res.json({ error: "履歴がない" });

  if (Date.now() - h.time > 172800000)
    return res.json({ error: "2日を超えています" });

  await db
    .collection("pages")
    .updateOne({ title }, { $set: { content: h.raw } });

  res.json({ ok: true });
});

app.listen(3000, () => console.log("Wiki running http://localhost:3000"));
