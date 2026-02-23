const { json } = require("./_utils");
const { clearSessionCookie } = require("./_security");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { code: -1, message: "Method Not Allowed" });
  clearSessionCookie(res);
  return json(res, 200, { code: 0, message: "已退出登录" });
};

