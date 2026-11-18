import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { TAG } from "../../../shared/world.ts";
import { josa } from "../../../shared/names.ts";
import { audio } from "../audio/AudioEngine.ts";
import { runtime } from "../game/runtime.ts";
import { getState, setState } from "../game/store.ts";
import { toast } from "../game/toast.ts";
import { network, ocean } from "../net/network.ts";

const HINT_KEY = "deep-drift:tag-hint";

function hintSeen(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === "1";
  } catch {
    return true;
  }
}

const nameOf = (id: string) => network.remotes.get(id)?.name || "누군가";

/**
 * 술래잡기 연출 담당 — 서버가 정한 상태의 변화를 보고 알림·소리·HUD·내 해파리 색을 맞춘다.
 * 판정은 하지 않는다 (서버가 한다).
 */
export function TagDirector() {
  const st = useRef({
    invitedBy: "",
    sentTo: "",
    with: "",
    it: false,
    hinted: hintSeen(),
  });

  useFrame(() => {
    const s = st.current;
    if (getState().phase !== "playing") return;

    // ---------------- 누군가 나에게 놀자고 청했다 ----------------
    let inviter = "";
    if (ocean.myId && !ocean.tagWith) {
      network.remotes.forEach((r) => {
        if (r.inviteTo === ocean.myId) inviter = r.id;
      });
    }
    if (inviter && inviter !== s.invitedBy) {
      const name = nameOf(inviter);
      toast(`${name}${josa(name, "이", "가")} 술래잡기하자고 빛을 보냈어요. 다가가서 E를 두 번 누르면 시작해요.`, 9000);
      const last = network.remotes.get(inviter)?.buffer.at(-1);
      if (last) audio.chime(runtime.pos.clone().set(last.x, last.y, last.z));
    }
    s.invitedBy = inviter;

    // ---------------- 내가 청했다 ----------------
    if (ocean.inviteTo !== s.sentTo) {
      s.sentTo = ocean.inviteTo;
      if (ocean.inviteTo && !ocean.tagWith) {
        const name = nameOf(ocean.inviteTo);
        toast(`${name}에게 놀자는 빛을 보냈어요. ${name}${josa(name, "이", "가")} E를 두 번 누르면 시작해요.`, 7000);
      }
    }

    // ---------------- 시작 · 끝 · 술래가 넘어감 ----------------
    if (ocean.tagWith !== s.with) {
      if (ocean.tagWith) {
        const name = nameOf(ocean.tagWith);
        setState({ tag: ocean.it ? "it" : "runner", tagPartner: name, tagEndsAt: Date.now() + TAG.durationMs });
        toast(
          ocean.it
            ? `술래잡기 시작! 내가 술래예요. ${name}에게 닿으면 넘겨줘요.`
            : `술래잡기 시작! ${name}${josa(name, "이", "가")} 술래예요. 도망쳐요!`,
          6000,
        );
        audio.tok(true);
      } else if (s.with) {
        setState({ tag: "", tagPartner: "", tagEndsAt: 0 });
        toast("즐거운 술래잡기였어요.", 5000);
      }
      s.with = ocean.tagWith;
      s.it = ocean.it;
    } else if (ocean.tagWith && ocean.it !== s.it) {
      s.it = ocean.it;
      setState({ tag: ocean.it ? "it" : "runner" });
      toast(ocean.it ? "잡혔어요! 이제 내가 술래예요." : "잡았다! 이제 도망쳐요.", 2500);
      audio.tok();
    }
    runtime.it = !!ocean.tagWith && ocean.it;

    // ---------------- 처음으로 누군가와 가까워졌을 때 한 번만 알려 준다 ----------------
    if (!s.hinted && runtime.bond > 0.8 && !ocean.tagWith) {
      s.hinted = true;
      try {
        localStorage.setItem(HINT_KEY, "1");
      } catch {
        /* noop */
      }
      toast("곁의 해파리에게 E를 짧게 두 번 누르면 술래잡기를 청할 수 있어요.", 8000);
    }
  });

  return null;
}
