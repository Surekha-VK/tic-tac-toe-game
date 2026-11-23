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
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6]
];

function winner(board) {
  for (const [a, b, c] of WIN_LINES) {
    if (
      board[a] &&
      board[a] === board[b] &&
      board[b] === board[c]
    ) {
      return board[a];
    }
  }

  return null;
}

function makeRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;

  do {
    code = Array.from(
      { length: 5 },
      () => chars[Math.floor(Math.random() * chars.length)]
    ).join("");
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

    players: room.players.map(player => ({
      symbol: player.symbol,
      name: player.name,
      connected: player.connected
    })),

    started:
      room.players.length === 2 &&
      room.players.every(player => player.connected)
  };
}

function broadcast(room) {
  io.to(room.code).emit("state", publicState(room));
}

function resetRoom(room) {
  room.board = Array(9).fill("");
  room.current = "X";
  room.winner = null;
  room.draw = false;
}

io.on("connection", socket => {

  // CREATE ROOM
  socket.on("create-room", ({ name } = {}, cb) => {
    const code = makeRoomCode();

    const room = {
      code,
      board: Array(9).fill(""),
      current: "X",
      winner: null,
      draw: false,

      players: [
        {
          id: socket.id,
          symbol: "X",
          name: String(name || "Player 1").slice(0, 20),
          connected: true
        }
      ]
    };

    rooms.set(code, room);

    socket.join(code);
    socket.data.room = code;
    socket.data.symbol = "X";

    if (typeof cb === "function") {
      cb({
        ok: true,
        code,
        symbol: "X"
      });
    }

    broadcast(room);
  });


  // JOIN ROOM / RECONNECT
  socket.on("join-room", ({ code, name } = {}, cb) => {

    code = String(code || "").trim().toUpperCase();

    const room = rooms.get(code);

    if (!room) {
      if (typeof cb === "function") {
        cb({
          ok: false,
          error: "Room not found. Check the code and try again."
        });
      }

      return;
    }


    // RECONNECT DISCONNECTED PLAYER
    const disconnectedPlayer = room.players.find(
      player => !player.connected
    );

    if (disconnectedPlayer) {

      disconnectedPlayer.id = socket.id;

      disconnectedPlayer.name = String(
        name || disconnectedPlayer.name || "Player"
      ).slice(0, 20);

      disconnectedPlayer.connected = true;

      socket.join(code);

      socket.data.room = code;
      socket.data.symbol = disconnectedPlayer.symbol;

      if (typeof cb === "function") {
        cb({
          ok: true,
          code,
          symbol: disconnectedPlayer.symbol,
          reconnected: true
        });
      }

      broadcast(room);

      return;
    }


    // ROOM FULL
    if (room.players.length >= 2) {
      if (typeof cb === "function") {
        cb({
          ok: false,
          error: "This room is already full."
        });
      }

      return;
    }


    // ADD PLAYER 2
    const player = {
      id: socket.id,
      symbol: "O",
      name: String(name || "Player 2").slice(0, 20),
      connected: true
    };

    room.players.push(player);

    socket.join(code);

    socket.data.room = code;
    socket.data.symbol = "O";

    if (typeof cb === "function") {
      cb({
        ok: true,
        code,
        symbol: "O"
      });
    }

    broadcast(room);
  });


  // PLAYER MOVE
  socket.on("move", ({ index } = {}) => {

    const code = socket.data.room;
    const room = rooms.get(code);

    if (
      !room ||
      room.players.length !== 2 ||
      !room.players.every(player => player.connected) ||
      room.winner ||
      room.draw
    ) {
      return;
    }

    const player = room.players.find(
      player => player.id === socket.id
    );

    if (
      !player ||
      !player.connected ||
      player.symbol !== room.current
    ) {
      return;
    }

    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index > 8 ||
      room.board[index] !== ""
    ) {
      return;
    }

    room.board[index] = player.symbol;

    room.winner = winner(room.board);

    room.draw =
      !room.winner &&
      room.board.every(cell => cell !== "");

    if (!room.winner && !room.draw) {
      room.current = room.current === "X" ? "O" : "X";
    }

    broadcast(room);
  });


  // REMATCH
  socket.on("rematch", () => {

    const room = rooms.get(socket.data.room);

    if (
      !room ||
      room.players.length !== 2 ||
      !room.players.every(player => player.connected)
    ) {
      return;
    }

    resetRoom(room);

    broadcast(room);
  });


  // LEAVE ROOM
  socket.on("leave-room", () => {

    const code = socket.data.room;

    if (!code) return;

    socket.leave(code);

    const room = rooms.get(code);

    if (room) {

      room.players = room.players.filter(
        player => player.id !== socket.id
      );

      if (room.players.length === 0) {
        rooms.delete(code);
      } else {
        broadcast(room);
      }
    }

    socket.data.room = null;
    socket.data.symbol = null;
  });


  // DISCONNECT / RECONNECT HANDLING
  socket.on("disconnect", () => {

    const code = socket.data.room;

    if (!code) return;

    const room = rooms.get(code);

    if (!room) return;

    const player = room.players.find(
      player => player.id === socket.id
    );

    if (!player) return;

    player.connected = false;

    const disconnectedSymbol = player.symbol;

    broadcast(room);


    // Keep room for 60 seconds to allow reconnecting
    setTimeout(() => {

      const latestRoom = rooms.get(code);

      if (!latestRoom) return;

      const samePlayer = latestRoom.players.find(
        player => player.symbol === disconnectedSymbol
      );

      if (samePlayer && !samePlayer.connected) {
        rooms.delete(code);
      }

    }, 60000);

  });

});


server.listen(PORT, () => {
  console.log(
    `Tic-Tac-Toe server listening on http://localhost:${PORT}`
  );
});
