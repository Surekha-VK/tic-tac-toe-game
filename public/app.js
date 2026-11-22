const $ = (s) => document.querySelector(s);
const cells = [...document.querySelectorAll(".cell")];
const winLines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
const socket = io();
let mode = "local", board = Array(9).fill(""), current = "X", gameOver = false, human = "X", bot = "O";
let difficulty = "hard", scores = {X:0,O:0,draw:0}, roomCode = "", mySymbol = null, onlineState = null;
let toastTimer;

// Handmade WebAudio sound palette: distinct X/O wooden taps, victory jingle and ambient loop.
let soundEnabled=true, audioCtx=null, musicTimer=null, musicStep=0, previousOnlineBoard=null, previousOnlineOutcome=null;
function audio(){if(!audioCtx){const AC=window.AudioContext||window.webkitAudioContext;if(AC)audioCtx=new AC();}if(audioCtx?.state==="suspended")audioCtx.resume();return audioCtx;}
function tone(freq,duration=.12,type="sine",volume=.045,delay=0){if(!soundEnabled)return;const ctx=audio();if(!ctx)return;const osc=ctx.createOscillator(),gain=ctx.createGain();osc.type=type;osc.frequency.setValueAtTime(freq,ctx.currentTime+delay);gain.gain.setValueAtTime(.0001,ctx.currentTime+delay);gain.gain.exponentialRampToValueAtTime(volume,ctx.currentTime+delay+.008);gain.gain.exponentialRampToValueAtTime(.0001,ctx.currentTime+delay+duration);osc.connect(gain);gain.connect(ctx.destination);osc.start(ctx.currentTime+delay);osc.stop(ctx.currentTime+delay+duration+.025);}
function noiseTap(duration=.045,volume=.018,delay=0){if(!soundEnabled)return;const ctx=audio();if(!ctx)return;const buffer=ctx.createBuffer(1,Math.floor(ctx.sampleRate*duration),ctx.sampleRate),data=buffer.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=(Math.random()*2-1)*(1-i/data.length);const src=ctx.createBufferSource(),gain=ctx.createGain();src.buffer=buffer;gain.gain.setValueAtTime(volume,ctx.currentTime+delay);gain.gain.exponentialRampToValueAtTime(.0001,ctx.currentTime+delay+duration);src.connect(gain);gain.connect(ctx.destination);src.start(ctx.currentTime+delay);}
function moveSound(symbol){if(symbol==="X"){tone(185,.095,"triangle",.07);tone(370,.09,"triangle",.025,.015);noiseTap(.04,.025);}else{tone(620,.1,"sine",.045);tone(920,.08,"sine",.022,.04);noiseTap(.035,.012,.025);}}
function winSound(){[523,659,784,988,1175].forEach((f,i)=>tone(f,.24,"triangle",.05,i*.09));tone(784,.36,"sine",.025,.48);}
function drawSound(){tone(440,.16,"sine",.04);tone(392,.16,"sine",.035,.13);tone(330,.28,"sine",.03,.27);}
function resetSound(){tone(520,.09,"triangle",.04);tone(390,.12,"triangle",.03,.08);}
function startMusic(){if(!soundEnabled||musicTimer)return;const notes=[523,659,784,659,587,698,880,698,494,587,698,587];musicTimer=setInterval(()=>{tone(notes[musicStep%notes.length],.23,"sine",.008);musicStep++;},520);}
function stopMusic(){if(musicTimer){clearInterval(musicTimer);musicTimer=null;}}
function toggleSound(){soundEnabled=!soundEnabled;const b=$("#sound-toggle");b.textContent=soundEnabled?"🔊":"🔇";b.setAttribute("aria-label",soundEnabled?"Turn sound off":"Turn sound on");if(soundEnabled){audio();startMusic();tone(660,.1,"sine",.04);}else stopMusic();}
const home = $("#home-screen"), gameScreen = $("#game-screen");
const aiPanel = $("#ai-settings"), onlinePanel = $("#online-panel");
const status = $("#status"), hint = $("#game-hint");

function toast(message){const t=$("#toast");t.textContent=message;t.classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove("show"),2500);}
function winnerFor(b){for(const line of winLines){const [a,c,d]=line;if(b[a]&&b[a]===b[c]&&b[c]===b[d])return b[a];}return null;}
function winningLine(b){for(const line of winLines){const [a,c,d]=line;if(b[a]&&b[a]===b[c]&&b[a]===b[d])return line;}return [];}
function render(b=board,turn=current,finished=gameOver,win=null,draw=false){
  cells.forEach((cell,i)=>{cell.textContent=b[i];cell.className="cell"+(b[i]==="X"?" x":b[i]==="O"?" o":"");cell.disabled=!!b[i]||finished;});
  if(win){winningLine(b).forEach(i=>cells[i].classList.add("win"));status.textContent=`${win} wins! 🎉`;}
  else if(draw) status.textContent="It's a draw!";
  else status.textContent=mode==="online"?(turn===mySymbol?"Your turn":"Opponent's turn"):`${turn}'s turn`;
}
function updateScore(){ $("#x-score").textContent=scores.X;$("#o-score").textContent=scores.O;$("#draw-score").textContent=scores.draw;}
function endLocal(result){gameOver=true;if(result){scores[result]++;winSound();}else{scores.draw++;drawSound();}updateScore();render(board,current,true,result,!result);hint.textContent=result?`${result} takes the round! Hit restart to play again.`:"A tie! Hit restart for another round.";}
function playLocal(index){
  if(gameOver||board[index])return;
  board[index]=current;moveSound(current);const w=winnerFor(board);
  if(w){endLocal(w);return;}
  if(board.every(Boolean)){endLocal(null);return;}
  current=current==="X"?"O":"X";render();
  if(mode==="ai"&&current===bot)setTimeout(aiTurn,400);
}
function emptyMoves(b){return b.map((v,i)=>v===""?i:-1).filter(i=>i>=0);}
function randomMove(b){const m=emptyMoves(b);return m.length?m[Math.floor(Math.random()*m.length)]:null;}
function tacticalMove(b,player){for(const i of emptyMoves(b)){b[i]=player;const w=winnerFor(b);b[i]="";if(w===player)return i;}return null;}
function mediumMove(b){
  let move=tacticalMove(b,bot);if(move!==null)return move;
  move=tacticalMove(b,human);if(move!==null)return move;
  if(b[4]==="")return 4;
  const corners=[0,2,6,8].filter(i=>b[i]==="");if(corners.length)return corners[Math.floor(Math.random()*corners.length)];
  return randomMove(b);
}
function minimax(b,player,depth=0){
  const w=winnerFor(b);if(w===bot)return 10-depth;if(w===human)return depth-10;if(b.every(Boolean))return 0;
  if(player===bot){let best=-Infinity;for(const i of emptyMoves(b)){b[i]=player;best=Math.max(best,minimax(b,human,depth+1));b[i]="";}return best;}
  let best=Infinity;for(const i of emptyMoves(b)){b[i]=player;best=Math.min(best,minimax(b,bot,depth+1));b[i]="";}return best;
}
function hardMove(b){let best=-Infinity,choice=null;for(const i of emptyMoves(b)){b[i]=bot;const score=minimax(b,human);b[i]="";if(score>best){best=score;choice=i;}}return choice;}
function aiTurn(){if(gameOver||current!==bot)return;let move=difficulty==="easy"?randomMove(board):difficulty==="medium"?mediumMove(board):hardMove(board);if(move!==null)playLocal(move);}
function startMode(selected){
  audio();startMusic();
  mode=selected;roomCode="";mySymbol=null;onlineState=null;previousOnlineBoard=null;previousOnlineOutcome=null;board=Array(9).fill("");current="X";gameOver=false;scores={X:0,O:0,draw:0};updateScore();
  home.classList.add("hidden");gameScreen.classList.remove("hidden");
  aiPanel.classList.toggle("hidden",mode!=="ai");onlinePanel.classList.toggle("hidden",mode!=="online");
  $("#mode-label").textContent=mode==="local"?"LOCAL MATCH":mode==="ai"?"SINGLE PLAYER":"ONLINE MULTIPLAYER";
  $("#game-title").textContent=mode==="local"?"Local 2 Player":mode==="ai"?"Play vs AI":"Play Online";
  $("#x-name").textContent=mode==="ai"?"You (X)":mode==="online"?"Player X":"Player X";
  $("#o-name").textContent=mode==="ai"?"AI (O)":mode==="online"?"Player O":"Player O";
  $("#online-setup").classList.remove("hidden");$("#room-info").classList.add("hidden");
  hint.textContent=mode==="online"?"Create a room or enter a friend's room code.":"Choose an empty square to make your move.";
  render();
}
document.querySelectorAll("[data-mode]").forEach(btn=>btn.addEventListener("click",()=>startMode(btn.dataset.mode)));
$("#back-home").addEventListener("click",()=>{if(mode==="online"&&roomCode)socket.emit("leave-room");gameScreen.classList.add("hidden");home.classList.remove("hidden");mode="local";});
$("#reset-game").addEventListener("click",()=>{
 if(mode==="online"&&roomCode){socket.emit("rematch");return;}
 board=Array(9).fill("");current="X";gameOver=false;render();resetSound();hint.textContent="New round — make your first move.";
});
$("#sound-toggle").addEventListener("click",toggleSound);
cells.forEach(c=>c.addEventListener("click",()=>{const i=Number(c.dataset.index);if(mode==="online"){if(roomCode&&onlineState?.started&&!onlineState.winner&&!onlineState.draw&&onlineState.current===mySymbol&&!onlineState.board[i])socket.emit("move",{index:i});}else playLocal(i);}));
document.querySelectorAll("[data-level]").forEach(btn=>btn.addEventListener("click",()=>{difficulty=btn.dataset.level;document.querySelectorAll("[data-level]").forEach(b=>b.classList.toggle("active",b===btn));$("#difficulty-note").textContent=difficulty==="easy"?"Easy: random legal moves.":difficulty==="medium"?"Medium: wins, blocks and positional strategy.":"Hard: unbeatable minimax strategy.";if(mode==="ai"&&!gameOver&&current===bot){aiTurn();}}));
$("#create-room").addEventListener("click",()=>{if(!socket.connected)return toast("Connecting… please try again in a moment.");socket.emit("create-room",{name:$("#player-name").value.trim()||"Player 1"},res=>{if(!res?.ok)return toast("Could not create room.");roomCode=res.code;mySymbol=res.symbol;showRoom(res.code);toast("Room created! Share the code with your friend.");});});
$("#join-room").addEventListener("click",()=>{const code=$("#room-code-input").value.trim();if(code.length!==5)return toast("Enter a 5-character room code.");socket.emit("join-room",{code,name:$("#player-name").value.trim()||"Player 2"},res=>{if(!res?.ok)return toast(res?.error||"Unable to join room.");roomCode=res.code;mySymbol=res.symbol;showRoom(res.code);toast("Joined room!");});});
function showRoom(code){$("#online-setup").classList.add("hidden");$("#room-info").classList.remove("hidden");$("#room-code").textContent=code;$("#x-name").textContent="Player X";$("#o-name").textContent="Player O";hint.textContent="Waiting for another player to join…";}
$("#copy-code").addEventListener("click",async()=>{try{await navigator.clipboard.writeText(roomCode);toast("Room code copied!");}catch{toast("Room code: "+roomCode);}});
socket.on("connect",()=>$("#connection-label").textContent="Connected");
socket.on("disconnect",()=>$("#connection-label").textContent="Disconnected — reconnecting");
socket.on("state",state=>{
 if(mode!=="online")return;onlineState=state;roomCode=state.code;
 if(previousOnlineBoard&&state.board.some((v,i)=>v!==previousOnlineBoard[i])){const i=state.board.findIndex((v,j)=>v!==previousOnlineBoard[j]);if(i>=0)moveSound(state.board[i]);}
 previousOnlineBoard=[...state.board];
 const outcome=state.winner|| (state.draw?"draw":null);if(outcome&&outcome!==previousOnlineOutcome){if(outcome==="draw")drawSound();else winSound();}previousOnlineOutcome=outcome;
 board=state.board;current=state.current;gameOver=!!state.winner||state.draw;
 render(board,current,gameOver,state.winner,state.draw);
 const me=state.players.find(p=>p.symbol===mySymbol);
 const other=state.players.find(p=>p.symbol!==mySymbol);
 if(me)$("#x-name").textContent=state.players.find(p=>p.symbol==="X")?.name||"Player X";
 if(other)$("#o-name").textContent=state.players.find(p=>p.symbol==="O")?.name||"Player O";
 if(!state.started)hint.textContent=state.players.length<2?"Waiting for a second player to join…":"Waiting for both players…";
 else if(state.winner)hint.textContent=state.winner===mySymbol?"You won! 🎉":"Your opponent won this round.";
 else if(state.draw)hint.textContent="Draw game. Click Restart for a rematch.";
 else hint.textContent=state.current===mySymbol?"Your turn — make a move.":"Waiting for your opponent's move.";
});
socket.on("room-error",msg=>toast(msg));
document.addEventListener("keydown",e=>{if(mode==="online"&&$("#room-code-input")===document.activeElement&&e.key==="Enter")$("#join-room").click();});
