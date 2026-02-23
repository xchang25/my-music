const { json } = require("./_utils");
const { getSession } = require("./_security");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { code: -1, message: "Method Not Allowed" });
  const session = getSession(req);
  return json(res, 200, {
    code: 0,
    loggedIn: !!session,
    user: session ? { uid: session.uid, role: session.role } : null
  });
};

