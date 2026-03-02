const http = require("http");
const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;

// roomCode -> { android: ws|null, pc: ws|null }
const rooms = new Map();

function getRoom(code) {
  if (!rooms.has(code)) rooms.set(code, { android: null, pc: null });
  return rooms.get(code);
}

const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end("OK");
});

const wss = new WebSocket.Server({ server });

wss.on("connection", (ws) => {
  ws.isAlive = true;
  ws.role = null;
  ws.room = null;

  ws.on("pong", () => (ws.isAlive = true));

  ws.on("message", (data, isBinary) => {
    console.log("MSG", ws.role, "room", ws.room, "binary?", isBinary, "len", isBinary ? data.length : data.toString().length);
  // 1) Se for BINÁRIO (ex: JPEG), encaminha direto
  if (isBinary) {
    if (!ws.room || !ws.role) {
      ws.send(JSON.stringify({ type: "error", message: "Dê join primeiro" }));
      return;
    }

    const room = rooms.get(ws.room);
    if (!room) return;

    const targetRole = ws.role === "android" ? "pc" : "android";
    const target = room[targetRole];

    if (!target || target.readyState !== WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "error", message: "Peer offline" }));
      return;
    }

    target.send(data, { binary: true });
    return;
  }

  // 2) Se for TEXTO, tratar como JSON
  let msg;
  try {
    msg = JSON.parse(data.toString());
  } catch {
    ws.send(JSON.stringify({ type: "error", message: "JSON inválido" }));
    return;
  }

  // join: {type:"join", role:"android"|"pc", room:"123456"}
  if (msg.type === "join") {
    const roomCode = String(msg.room || "").trim();
    const role = msg.role;

    if (!roomCode || (role !== "android" && role !== "pc")) {
      ws.send(JSON.stringify({ type: "error", message: "join inválido" }));
      return;
    }

    const room = getRoom(roomCode);

    // substitui conexão anterior do mesmo role
    if (room[role] && room[role].readyState === WebSocket.OPEN) {
      room[role].close(4000, "Substituído por nova conexão");
    }

    room[role] = ws;
    ws.role = role;
    ws.room = roomCode;

    ws.send(JSON.stringify({ type: "joined", role, room: roomCode }));

    const otherRole = role === "android" ? "pc" : "android";
    const other = room[otherRole];
    if (other && other.readyState === WebSocket.OPEN) {
      other.send(JSON.stringify({ type: "peer_online", role }));
    }
    return;
  }

  // encaminhar JSON para o outro lado
  if (!ws.room || !ws.role) {
    ws.send(JSON.stringify({ type: "error", message: "Dê join primeiro" }));
    return;
  }

  const room = rooms.get(ws.room);
  if (!room) return;

  const targetRole = ws.role === "android" ? "pc" : "android";
  const target = room[targetRole];

  if (!target || target.readyState !== WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "error", message: "Peer offline" }));
    return;
  }

  msg._from = ws.role;
  target.send(JSON.stringify(msg));
});