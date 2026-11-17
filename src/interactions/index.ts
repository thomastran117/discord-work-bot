import {askEnv} from "./handler.ts";
import {createAskServer} from "./server.ts";

const env=askEnv(process.env);
const port=Number(process.env.PORT ?? "8080");
if (!Number.isInteger(port) || port<1 || port>65535) throw new Error("Invalid PORT");
const {server,shutdown}=createAskServer(env);
server.listen(port,"0.0.0.0",()=>console.log("ask_service_started",port));
let stopping=false;
function stop() {
  if (stopping) return;
  stopping=true;
  void shutdown().catch(()=>{process.exitCode=1;});
}
process.once("SIGTERM",stop);
process.once("SIGINT",stop);
