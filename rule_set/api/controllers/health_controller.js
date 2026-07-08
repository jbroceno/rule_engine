export function getHealth(_req, res) {
  res.status(200).json({
    status: "ok",
    service: "rule-set-api",
    timestamp: new Date().toISOString(),
  });
}
