// 익명 이름 — 정해진 단어 두 개의 조합으로만 만든다.
// 자유롭게 입력받지 않으므로 욕설·광고를 걸러낼 필요가 없고, 서버는 번호만 검증하면 된다.

export const NAME_FIRST = [
  "새벽의",
  "느린",
  "푸른",
  "고요한",
  "작은",
  "포근한",
  "잔잔한",
  "깊은",
  "맑은",
  "느긋한",
  "졸린",
  "따뜻한",
  "수줍은",
  "은은한",
  "말랑한",
  "희미한",
  "투명한",
  "보랏빛",
  "달빛",
  "별빛의",
  "먼",
  "한밤의",
  "부드러운",
  "흔들리는",
] as const;

export const NAME_SECOND = [
  "물결",
  "등불",
  "숨",
  "파도",
  "조약돌",
  "거품",
  "별",
  "구름",
  "달",
  "산호",
  "진주",
  "모래",
  "바람",
  "노래",
  "꿈",
  "섬",
  "물방울",
  "불빛",
  "안개",
  "소라",
  "해초",
  "그림자",
  "온기",
  "메아리",
] as const;

export function isValidNamePart(v: unknown, list: readonly string[]): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v < list.length;
}

export function composeName(first: number, second: number): string {
  return `${NAME_FIRST[first]} ${NAME_SECOND[second]}`;
}

export function randomNameParts(): [number, number] {
  return [Math.floor(Math.random() * NAME_FIRST.length), Math.floor(Math.random() * NAME_SECOND.length)];
}

/**
 * 받침이 있으면 withBatchim, 없으면 without — "물결이" / "파도가".
 * "으로/로"는 ㄹ 받침 뒤에서도 "로"를 쓴다 — "물방울로".
 */
export function josa(word: string, withBatchim: string, without: string): string {
  const code = word.charCodeAt(word.length - 1);
  if (code < 0xac00 || code > 0xd7a3) return without;
  const jong = (code - 0xac00) % 28;
  if (jong === 0) return without;
  if (jong === 8 && withBatchim === "으로") return without;
  return withBatchim;
}
