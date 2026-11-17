import { MapSchema, Schema, type } from "@colyseus/schema";

export class Jelly extends Schema {
  @type("float32") x = 0;
  @type("float32") y = 0;
  @type("float32") z = 0;
  @type("float32") yaw = 0;
  @type("float32") lean = 0;
  @type("float32") speed = 0;
  @type("uint8") variant = 0;
  @type("boolean") connected = true;
  /** 익명 이름 — 서버가 정해진 단어 목록에서 조합한다 */
  @type("string") name = "";
  /** 쉬는 중 (일시정지했거나 다른 탭으로 가 있음) */
  @type("boolean") resting = false;
  /** 인사할 때마다 1씩 늘어난다 (값이 바뀌면 다른 클라이언트가 빛을 재생) */
  @type("uint8") glow = 0;
}

export class OceanState extends Schema {
  @type({ map: Jelly }) players = new MapSchema<Jelly>();
}
