const express = require("express");
const { MongoClient } = require("mongodb");
const bodyParser = require("body-parser");
const multer = require("multer");
const sanitizeHtml = require("sanitize-html");
const cors = require("cors");

const app = express();
const upload = multer({ limits: { fileSize: 3 * 1024 * 1024 } }); // 3MB

app.use(cors());
app.use(bodyParser.json());
app.use(express.static("public"));

const MONGO_URL = process.env.MONGO_URI;

let db;

// ---- メモリキャッシュ ----
let userCache = {};      // username → user object
let userListCache = [];  // 全ユーザー配列

// ---- URL → a タグへ置換 ----
function autoLink(text) {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  return text.replace(urlRegex, (url) => {
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
  });
}

// ---- キャッシュ読み込み ----
async function loadCache() {
  console.log("Loading cache from MongoDB...");
  const users = await db.collection("users").find({}).toArray();

  userCache = {};
  for (const u of users) {
    userCache[u.username] = u;
  }

  userListCache = users;

  console.log("Cache ready:", users.length, "users loaded");
}

// ---- ページ編集 ----
app.post("/api/edit", async (req, res) => {
  const { username, body } = req.body;

  if (!username) return res.json({ error: "ユーザー名必須" });

  // URL をリンク化
  const linked = autoLink(body);

  const cleanBody = sanitizeHtml(linked, {
    allowedTags: [
      "b", "i", "u", "del", "span",
      "h2", "h3", "p", "br",
      "ul", "ol", "li", "a"
    ],
    allowedAttributes: {
      span: ["style"],
      a: ["href", "target", "rel"],
    }
  });

  await db.collection("users").updateOne(
    { username },
    {
      $set: { username, body: cleanBody },
      $push: { history: { time: Date.now(), raw: cleanBody } }
    },
    { upsert: true }
  );

  // ---- キャッシュ更新 ----
  if (!userCache[username]) {
    userCache[username] = { username, body: cleanBody };
    userListCache.push(userCache[username]);
  } else {
    userCache[username].body = cleanBody;
  }

  res.json({ ok: true });
});

// ---- アイコンアップロード ----
app.post("/api/icon", upload.single("icon"), async (req, res) => {
  const username = req.body.username;
  if (!req.file || !username)
    return res.json({ error: "画像とユーザー名必須" });

  const base64 =
    "data:image/png;base64," + req.file.buffer.toString("base64");

  await db.collection("users").updateOne(
    { username },
    { $set: { username, icon: base64 } },
    { upsert: true }
  );

  // ---- キャッシュ更新 ----
  if (!userCache[username]) {
    userCache[username] = { username, icon: base64 };
    userListCache.push(userCache[username]);
  } else {
    userCache[username].icon = base64;
  }

  res.json({ ok: true });
});

// ---- ユーザー取得（キャッシュ100%優先） ----
app.get("/api/user", (req, res) => {
  const username = req.query.username;
  res.json({ user: userCache[username] || null });
});

// ---- ユーザー一覧（キャッシュ100%優先） ----
app.get("/api/users", (req, res) => {
  res.json(userListCache);
});

// ---- ★ここが今回の最大の修正ポイント ----
// ---- MongoDB → キャッシュ読み込み → listen ----

async function startServer() {
  if (!MONGO_URL) {
    console.error("MONGO_URI が指定されていません");
    process.exit(1);
  }

  console.log("Connecting to MongoDB...");
  const client = await MongoClient.connect(MONGO_URL);
  db = client.db("wiki");
  console.log("MongoDB connected");

  await loadCache(); // ← キャッシュのロードを listen より前に実行する！

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Wiki running http://localhost:${PORT}`);
  });
}

// ---- サーバーを起動 ----
startServer();
