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
}

export class OceanState extends Schema {
  @type({ map: Jelly }) players = new MapSchema<Jelly>();
}
