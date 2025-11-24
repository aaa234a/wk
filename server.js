const express = require("express");
const { MongoClient } = require("mongodb");
const bodyParser = require("body-parser");
const sanitizeHtml = require("sanitize-html");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static("public"));

const MONGO_URL = process.env.MONGO_URI;
if (!MONGO_URL) {
  console.error("ERROR: MONGO_URI が設定されていません！");
  process.exit(1);
}

let db;
MongoClient.connect(MONGO_URL)
  .then((client) => {
    db = client.db("wiki");
    console.log("MongoDB connected");
  })
  .catch((err) => {
    console.error("MongoDB connection error:", err);
    process.exit(1);
  });

// --- ページ編集 ---
app.post("/api/edit", async (req, res) => {
  const { username, body, iconURL } = req.body;
  const ip = req.ip;
  if (!username) return res.json({ error: "ユーザー名が必要です" });

  const cleanBody = sanitizeHtml(body, {
    allowedTags: [
      "b",
      "i",
      "u",
      "del",
      "span",
      "h2",
      "h3",
      "p",
      "br",
      "ul",
      "ol",
      "li",
    ],
    allowedAttributes: { span: ["style"] },
  });

  // --- 既存 /api/edit の $push に history 配列追加済み ---
  await db.collection("users").updateOne(
    { username },
    {
      $set: { username, body: cleanBody, iconURL, lastEditorIP: ip },
      $push: {
        history: {
          time: Date.now(),
          ip,
          masked: ip.replace(/\.\d+$/, ".*"),
          raw: cleanBody,
        },
      },
    },
    { upsert: true }
  );

  res.json({ ok: true });
});

// --- ユーザー取得 ---
app.get("/api/user", async (req, res) => {
  const username = req.query.username;
  const user = await db.collection("users").findOne({ username });
  res.json({ user });
});

// --- ユーザー一覧 ---
app.get("/api/users", async (req, res) => {
  const users = await db.collection("users").find({}).toArray();
  res.json(users);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Wiki running http://localhost:${PORT}`));
