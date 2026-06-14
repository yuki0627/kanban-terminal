import { Server as IOServer } from "socket.io";

// Minimal socket.io pub/sub, modeled on mulmoclaude's server/events/pub-sub.
// Channel names are socket.io rooms — subscribe/unsubscribe map to
// socket.join / socket.leave, and publish broadcasts to the room.
// socket.io handles reconnect / heartbeat / transport for us.
export function createPubSub(server) {
  const io = new IOServer(server, {
    path: "/ws/pubsub",
    cors: { origin: true, credentials: true },
    transports: ["websocket"],
  });

  io.on("connection", (socket) => {
    socket.on("subscribe", (channel) => {
      if (typeof channel === "string") socket.join(channel);
    });
    socket.on("unsubscribe", (channel) => {
      if (typeof channel === "string") socket.leave(channel);
    });
  });

  return {
    publish(channel, data) {
      io.to(channel).emit("data", { channel, data });
    },
  };
}
