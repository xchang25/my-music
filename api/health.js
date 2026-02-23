const { json } = require("./_utils");

module.exports = async function handler(req, res) {
  return json(res, 200, { ok: true, service: "tunehub-player", ts: Date.now() });
};

