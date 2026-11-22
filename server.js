const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (_, res) => res.json({ ok: true }));

const rooms = new Map();
const WIN_LINES = [
  [0,1,2],[3,4,5],[6,7,8],
  [0,3,6],[1,4,7],[2,5,8],
  [0,4,8],[2,4,6]
];

function winner(board) {
  for (const [a,b,c] of WIN_LINES) {
    if (board[a] && board[a] === board[b] && board[b] === board[c]) return board[a];
  }
  return null;
}
function makeRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = Array.from({length:5}, () => chars[Math.floor(Math.random()*chars.length)]).join("");
  } while (rooms.has(code));
  return code;
}
function publicState(room) {
  return {
    code: room.code,
    board: room.board,
    current: room.current,
    winner: room.winner,
    draw: room.draw,
    players: room.players.map(p => ({symbol:p.symbol, name:p.name, connected:p.connected})),
    started: room.players.length === 2 && room.players.every(p => p.connected)
  };
}
function broadcast(room) { io.to(room.code).emit("state", publicState(room)); }
function resetRoom(room) {
  room.board = Array(9).fill("");
  room.current = "X";
  room.winner = null;
  room.draw = false;
}

io.on("connection", socket => {
  socket.on("create-room", ({name} = {}, cb) => {
    const code = makeRoomCode();
    const room = { code, board:Array(9).fill(""), current:"X", winner:null, draw:false,
      players:[{id:socket.id, symbol:"X", name:String(name||"Player 1").slice(0,20), connected:true}] };
    rooms.set(code, room);
    socket.join(code);
    socket.data.room = code;
    socket.data.symbol = "X";
    if (typeof cb === "function") cb({ok:true, code, symbol:"X"});
    broadcast(room);
  });

  socket.on("join-room", ({code, name} = {}, cb) => {
    code = String(code||"").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return typeof cb === "function" ? cb({ok:false, error:"Room not found. Check the code and try again."}) : undefined;
    if (room.players.length >= 2) return typeof cb === "function" ? cb({ok:false, error:"This room is already full."}) : undefined;
    const player = {id:socket.id, symbol:"O", name:String(name||"Player 2").slice(0,20), connected:true};
    room.players.push(player);
    socket.join(code);
    socket.data.room = code;
    socket.data.symbol = "O";
    if (typeof cb === "function") cb({ok:true, code, symbol:"O"});
    broadcast(room);
  });

  socket.on("move", ({index} = {}) => {
    const code = socket.data.room;
    const room = rooms.get(code);
    if (!room || room.players.length !== 2 || room.winner || room.draw) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player || !player.connected || player.symbol !== room.current) return;
    if (!Number.isInteger(index) || index < 0 || index > 8 || room.board[index] !== "") return;
    room.board[index] = player.symbol;
    room.winner = winner(room.board);
    room.draw = !room.winner && room.board.every(cell => cell !== "");
    if (!room.winner && !room.draw) room.current = room.current === "X" ? "O" : "X";
    broadcast(room);
  });

  socket.on("rematch", () => {
    const room = rooms.get(socket.data.room);
    if (!room || room.players.length !== 2) return;
    resetRoom(room);
    broadcast(room);
  });

  socket.on("leave-room", () => {
    const code = socket.data.room;
    if (code) {
      socket.leave(code);
      const room = rooms.get(code);
      if (room) {
        room.players = room.players.filter(p => p.id !== socket.id);
        if (room.players.length === 0) rooms.delete(code);
        else broadcast(room);
      }
      socket.data.room = null;
      socket.data.symbol = null;
    }
  });

  socket.on("disconnect", () => {
    const code = socket.data.room;
    const room = rooms.get(code);
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (player) player.connected = false;
    broadcast(room);
    // Clean abandoned rooms after a short grace period.
    setTimeout(() => {
      const latest = rooms.get(code);
      if (latest && latest.players.some(p => !p.connected)) rooms.delete(code);
    }, 60000);
  });
});

server.listen(PORT, () => console.log(`Tic-Tac-Toe server listening on http://localhost:${PORT}`));