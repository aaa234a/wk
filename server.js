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
MongoClient.connect(MONGO_URL)
  .then((client) => {
    db = client.db("wiki");
    console.log("MongoDB connected");
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

// --- ページ編集 ---
app.post("/api/edit", async (req, res) => {
  const { username, body } = req.body;
  const ip = req.headers["x-forwarded-for"] || req.ip;
  if (!username) return res.json({ error: "ユーザー名必須" });

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

  await db.collection("users").updateOne(
    { username },
    {
      $set: { username, body: cleanBody, lastEditorIP: ip },
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

// --- アイコンアップロード ---
app.post("/api/icon", upload.single("icon"), async (req, res) => {
  const ip = req.headers["x-forwarded-for"] || req.ip;
  const username = req.body.username;
  if (!req.file || !username)
    return res.json({ error: "画像とユーザー名必須" });

  const base64 = "data:image/png;base64," + req.file.buffer.toString("base64");

  await db
    .collection("users")
    .updateOne(
      { username },
      { $set: { username, icon: base64 } },
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
