import { stdin, stdout } from "node:process";

export type ReceiveUpdate = { oldOid: string; oid: string; ref: string };
export type ReceiveResult = { ref: string };

const flush = Symbol("flush");
type Packet = Buffer | typeof flush;

function debug(message: string): void {
  if (process.env.CHESSHUB_DEBUG) {
    console.error(`proc-receive: ${message}`);
  }
}

class PacketReader {
  readonly #packets: Packet[] = [];
  readonly #waiters: Array<{
    resolve: (packet: Packet) => void;
    reject: (error: Error) => void;
  }> = [];
  #buffer = Buffer.alloc(0);
  #ended = false;

  constructor() {
    stdin.on("data", (chunk: Buffer) => {
      this.#buffer = Buffer.concat([this.#buffer, chunk]);
      this.#parse();
    });
    stdin.on("end", () => {
      this.#ended = true;
      this.#rejectWaiters(new Error("unexpected end of proc-receive input"));
    });
    stdin.on("error", (error) => this.#rejectWaiters(error));
  }

  next(): Promise<Packet> {
    const packet = this.#packets.shift();
    if (packet !== undefined) {
      return Promise.resolve(packet);
    }
    if (this.#ended) {
      return Promise.reject(new Error("unexpected end of proc-receive input"));
    }
    return new Promise((resolve, reject) => {
      this.#waiters.push({ resolve, reject });
    });
  }

  #parse(): void {
    while (this.#buffer.length >= 4) {
      const header = this.#buffer.subarray(0, 4).toString("ascii");
      if (!/^[0-9a-fA-F]{4}$/.test(header)) {
        this.#rejectWaiters(new Error(`invalid pkt-line header: ${header}`));
        return;
      }

      const length = Number.parseInt(header, 16);
      if (length === 0) {
        this.#buffer = this.#buffer.subarray(4);
        this.#emit(flush);
        continue;
      }
      if (length < 4) {
        this.#rejectWaiters(
          new Error(`unsupported pkt-line control packet: ${header}`),
        );
        return;
      }
      if (this.#buffer.length < length) {
        return;
      }

      const payload = this.#buffer.subarray(4, length);
      this.#buffer = this.#buffer.subarray(length);
      this.#emit(payload);
    }
  }

  #emit(packet: Packet): void {
    const waiter = this.#waiters.shift();
    if (waiter) {
      waiter.resolve(packet);
    } else {
      this.#packets.push(packet);
    }
  }

  #rejectWaiters(error: Error): void {
    for (const waiter of this.#waiters.splice(0)) {
      waiter.reject(error);
    }
  }
}

function writePacket(payload: string): void {
  const body = Buffer.from(payload, "utf8");
  const length = (body.length + 4).toString(16).padStart(4, "0");
  stdout.write(length);
  stdout.write(body);
}

function writeFlush(): void {
  stdout.write("0000");
}

async function readSection(reader: PacketReader): Promise<Buffer[]> {
  const packets: Buffer[] = [];
  while (true) {
    const packet = await reader.next();
    if (packet === flush) {
      return packets;
    }
    packets.push(packet);
  }
}

// The callback applies the entire batch or throws; framing and status stay here.
export async function procReceive(
  apply: (
    updates: ReceiveUpdate[],
    pushOptions: string[],
  ) => ReceiveResult[] | Promise<ReceiveResult[]>,
): Promise<void> {
  const reader = new PacketReader();
  const negotiation = await readSection(reader);
  debug(`received ${negotiation.length} negotiation packet(s)`);
  const [version] = negotiation;
  const offer = version?.toString("utf8");
  debug(`version offer: ${JSON.stringify(offer)}`);
  if (!offer?.startsWith("version=1")) {
    throw new Error(
      `receive-pack did not offer proc-receive protocol v1: ${version?.toString("utf8")}`,
    );
  }

  const features = new Set((offer.split("\0", 2)[1] ?? "").trim().split(/\s+/).filter(Boolean));
  const acceptsPushOptions = features.has("push-options");

  writePacket(`version=1\0${acceptsPushOptions ? "push-options" : ""}`);
  writeFlush();
  debug("sent version response");

  const commands = await readSection(reader);
  debug(`received ${commands.length} command(s)`);
  const updates = commands.map((command) => {
    const [oldOid, oid, ref] = command.toString("utf8").trimEnd().split(" ");
    if (!oldOid || !oid || !ref) {
      throw new Error(`invalid proc-receive command: ${command.toString()}`);
    }
    return { oldOid, oid, ref };
  });
  const pushOptions = acceptsPushOptions
    ? (await readSection(reader)).map((option) => option.toString("utf8"))
    : [];
  debug(`received ${pushOptions.length} push option(s)`);
  try {
    const results = await apply(updates, pushOptions);
    for (const result of results) {
      writePacket(`ok ${result.ref}`);
    }
  } catch (error) {
    const reason = (error instanceof Error ? error.message : String(error)).replace(/[\r\n\0]/g, " ");
    for (const { ref } of updates) writePacket(`ng ${ref} ${reason}`);
  }
  writeFlush();
  debug("sent command results");
  stdin.pause();
}
