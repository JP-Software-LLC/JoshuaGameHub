// Typing Cowboys room: same flow as Rush Hour (each browser runs its own typing race; the server relays
// progress ~10×/s and ranks finish times). pos.d = words typed (0–DIST). finish.extra = words missed.
// The race waits for everyone: it only closes early AFTER_FIRST ms after the winner (slow typists get minutes).
"use strict";
const { RushRoom }=require("./rushroom");
const TYPING=require("../shared/typing.js");
class TypingRoom extends RushRoom {}
TypingRoom.KIND="typing"; TypingRoom.DIST=TYPING.T.dist; TypingRoom.AFTER_FIRST=+process.env.TYPING_AFTER_FIRST_MS||4*60*1000;
module.exports={ TypingRoom };
