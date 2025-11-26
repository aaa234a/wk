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
if (!MONGO_URL) {
  console.error("MONGO_URI が必要");
  process.exit(1);
}

let db;

// ---- メモリキャッシュ ----
let userCache = {};   // username → user object
let userListCache = []; // 全ユーザー配列

// ---- キャッシュ更新関数 ----
async function loadCache() {
  console.log("Loading cache from MongoDB...");
  const users = await db.collection("users").find({}).toArray();

  userCache = {};
  users.forEach((u) => {
    userCache[u.username] = u;
  });

  userListCache = users;

  console.log("Cache ready: " + users.length + " users loaded");
}

// ---- MongoDB 接続 ----
MongoClient.connect(MONGO_URL)
  .then(async (client) => {
    db = client.db("wiki");
    console.log("MongoDB connected");
    await loadCache(); // ★ 起動時キャッシュ
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

// --- ページ編集 ---
app.post("/api/edit", async (req, res) => {
  const { username, body } = req.body;

  if (!username) return res.json({ error: "ユーザー名必須" });

  const cleanBody = sanitizeHtml(body, {
    allowedTags: ["b", "i", "u", "del", "span", "h2", "h3", "p", "br", "ul", "ol", "li"],
    allowedAttributes: { span: ["style"] },
  });

  const update = {
    username,
    body: cleanBody,
  };

  await db.collection("users").updateOne(
    { username },
    {
      $set: update,
      $push: {
        history: { time: Date.now(), raw: cleanBody },
      },
    },
    { upsert: true }
  );

  // ---- キャッシュ更新 ----
  if (!userCache[username]) {
    userListCache.push(update);
  }

  userCache[username] = {
    ...(userCache[username] || {}),
    ...update,
  };

  res.json({ ok: true });
});

// --- アイコンアップロード ---
app.post("/api/icon", upload.single("icon"), async (req, res) => {
  const username = req.body.username;

  if (!req.file || !username)
    return res.json({ error: "画像とユーザー名必須" });

  const base64 = "data:image/png;base64," + req.file.buffer.toString("base64");

  await db.collection("users").updateOne(
    { username },
    { $set: { username, icon: base64 } },
    { upsert: true }
  );

  // ---- キャッシュ反映 ----
  if (!userCache[username]) {
    userCache[username] = { username, icon: base64 };
    userListCache.push(userCache[username]);
  } else {
    userCache[username].icon = base64;
  }

  res.json({ ok: true });
});

// --- ユーザー取得 ---
app.get("/api/user", async (req, res) => {
  const username = req.query.username;

  // ★ キャッシュ返す
  res.json({ user: userCache[username] || null });
});

// --- ユーザー一覧 ---
app.get("/api/users", async (req, res) => {
  // ★ キャッシュ返す
  res.json(userListCache);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Wiki running http://localhost:${PORT}`));
