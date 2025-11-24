const express = require("express");
const { MongoClient } = require("mongodb");
const bodyParser = require("body-parser");
const multer = require("multer");
const sanitizeHtml = require("sanitize-html");
const cors = require("cors");

const app = express();
const upload = multer({ limits: { fileSize: 3 * 1024 * 1024 } }); // 3MB

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

app.use(cors());
app.use(bodyParser.json());
app.use(express.static("public"));

// --- ページ編集 ---
app.post("/api/edit", async (req, res) => {
  const { name, body } = req.body;
  const ip = req.ip;

  if (!name) return res.json({ error: "ページ名が必要" });

  await db.collection("pages").updateOne(
    { name },
    {
      $set: { name, body, lastEditorIP: ip },
      $push: {
        history: {
          time: Date.now(),
          ip,
          masked: ip.replace(/\.\d+$/, ".*"),
          raw: body,
        },
      },
    },
    { upsert: true }
  );

  res.json({ ok: true });
});

// --- ページ取得 ---
app.get("/api/page", async (req, res) => {
  const name = req.query.name;
  const page = await db.collection("pages").findOne({ name });
  res.json({ page });
});

// --- ページ一覧 ---
app.get("/api/pages", async (req, res) => {
  const pages = await db.collection("pages").find({}).toArray();
  res.json(pages);
});

// --- ユーザー一覧 ---
app.get("/api/users", async (req, res) => {
  const users = await db.collection("users").find({}).toArray();
  res.json(users);
});

// --- アイコンアップロード ---
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

// --- サーバ起動 ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Wiki running http://localhost:${PORT}`);
});
