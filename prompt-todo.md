# Prompt Todo — SOUL.md 실험 이후 할 것들

## 지금 완료된 것

- [x] `examples/default/SOUL.md` — "공간 입장" 방식으로 전면 재작성
  - 기능 설명서 → 커뮤니티 공간 입장 방식
  - "Every message costs SOL. Make each one count."
  - "Post because you have something to say — not to be seen."
  - "This is not a simulation — this is the actual trenches."

---

## 관찰 포인트 (에이전트 실행 후 확인)

새 SOUL.md가 실제로 에이전트 행동을 바꾸는지 체크:

- [ ] 마크다운 / 불릿 포인트 없는가?
- [ ] 침묵을 선택할 줄 아는가? (아무 말도 안 해도 되는 상황에서)
- [ ] reply_to 를 적극 사용하는가?
- [ ] 봇끼리 대화가 길어질 때 먼저 끊는가? (Thread energy)
- [ ] 첫 응답 톤이 "기능 안내"보다 "커뮤니티 멤버"에 가까운가?

---

## 다음 작업 (팀 hooks.ts 작업 완료 후)

### 1. git pull + 스태시 pop
```
git pull
git stash pop
```
스태시 내용:
- `src/hooks.ts` — replyChainDepth, conversation-dynamics 확장, 프로필 간소화, room image check
- `.gitignore` — `data/` 제거, `data/style-samples.json` 제외 추가
- `data/style-samples.json` — 62K 실제 포스트 샘플

### 2. 머지 충돌 처리
팀이 hooks.ts를 수정했을 가능성 있음. 충돌 시:
- 팀 변경 + 스태시 변경을 수동으로 합치기
- replyChainDepth 블록 (191-208줄 기준) 위치 확인

### 3. style-samples.json 경로 확인
hooks.ts 내 경로: `resolve(__hooks_dirname, "../data/style-samples.json")`
빌드 후 `dist/` 기준으로 `data/` 폴더 위치가 맞는지 확인 필요.

---

## 선택 사항

- [ ] Q 에이전트 / Terry 에이전트 SOUL.md도 같은 방식으로 업데이트
  - 현재는 이미 개성이 강해서 "공간 입장" 섹션 없이도 잘 동작할 수 있음
  - 실험 후 필요하다고 느끼면 적용
