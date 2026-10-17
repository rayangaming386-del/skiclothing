"""Minimale SMTP-ontvanger voor tests: bewaart elke e-mail als JSON-regel in MAIL_LOG."""
import asyncio, json, os, sys, email
from email import policy

LOG = os.environ.get("MAIL_LOG", "mails.jsonl")
PORT = int(os.environ.get("SMTP_PORT", "2500"))

async def handle(reader, writer):
    def send(line):
        writer.write((line + "\r\n").encode())
    send("220 mailsink ready")
    await writer.drain()
    rcpts, data_mode, buf = [], False, []
    while True:
        line = await reader.readline()
        if not line:
            break
        text = line.decode(errors="replace").rstrip("\r\n")
        if data_mode:
            if text == ".":
                data_mode = False
                msg = email.message_from_string("\n".join(buf), policy=policy.default)
                body = msg.get_body(preferencelist=("html", "plain"))
                with open(LOG, "a") as f:
                    f.write(json.dumps({"to": rcpts, "subject": str(msg["subject"]), "body": body.get_content() if body else ""}) + "\n")
                rcpts, buf = [], []
                send("250 OK")
            else:
                buf.append(text[1:] if text.startswith("..") else text)
            await writer.drain()
            continue
        cmd = text.upper()
        if cmd.startswith("EHLO") or cmd.startswith("HELO"):
            send("250 mailsink")
        elif cmd.startswith("MAIL FROM"):
            send("250 OK")
        elif cmd.startswith("RCPT TO"):
            rcpts.append(text.split(":", 1)[1].strip().strip("<>").lower())
            send("250 OK")
        elif cmd == "DATA":
            data_mode = True
            send("354 End data with <CR><LF>.<CR><LF>")
        elif cmd == "QUIT":
            send("221 Bye")
            await writer.drain()
            break
        else:
            send("250 OK")
        await writer.drain()
    writer.close()

async def main():
    server = await asyncio.start_server(handle, "127.0.0.1", PORT)
    print(f"mailsink op poort {PORT}, log {LOG}", flush=True)
    async with server:
        await server.serve_forever()

asyncio.run(main())
