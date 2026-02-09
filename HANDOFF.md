# WeekFlow 작업 핸드오프

> 작성일: 2026-02-09
> 마지막 커밋: `f525edf` docs: defer 5-min diagonal cell click from Phase 2 scope

## 프로젝트 개요

WeekFlow는 Obsidian 플러그인으로, 데일리 노트의 마크다운 체크박스 리스트를 주간 타임테이블 그리드로 시각화한다. `SPEC.md`에 전체 스펙이 정의되어 있고, `CLAUDE.md`에 개발 가이드가 있다.

## 완료된 Phase

### Phase 1 (Core MVP) — 커밋 `18d1cbe`
- 주간 타임테이블 그리드 렌더링 (10분 단위 셀, CSS Grid)
- 데일리 노트 파싱/직렬화 (Tasks 플러그인 메타데이터 보존)
- 셀 드래그로 블록 생성 → BlockModal → 데일리 노트 저장
- Plan/Actual 모드 토글, 카테고리 팔레트
- 주간 네비게이션, 설정 탭

### Phase 2 (Block Editing & Sync) — 커밋 `5fd95be` + `47fa0b8` + `f525edf`
구현된 서브태스크:
- **2-A** TimelineItem에 런타임 `id: string` 추가 (마크다운에는 저장 안 함)
- **2-B** EditBlockModal — 블록 클릭 시 시간/내용/카테고리 편집 + 삭제
- **2-C** 블록 드래그 이동 — 같은 날 시간 이동 + 다른 날 크로스데이 이동
- **2-D** 블록 좌/우 경계 리사이즈 (ew-resize 핸들)
- **2-E** 양방향 동기화 — `vault.on('modify')` + `active-leaf-change`, `isSelfWriting` 가드, 300ms debounce
- **2-F** 5분 단위 — EditBlockModal의 time input에서 5분 단위 입력 가능
- **2-G** 자정 넘김 자동 분리 (dayEndHour 초과 시 다음 날로 split)
- **2-H** Undo/Redo 스택 (Command pattern, 50개 제한, Mod+Z / Mod+Shift+Z)
- **2-I** 에러 핸들링 — ParseResult에 warnings 포함, 경고 배너, 시간 겹침 블록 시각적 표시
- **2-J** 5분 대각선 렌더링 — `clip-path`로 5분 블록 엣지를 대각선으로 시각화, `::before`/`::after`로 대각선 경계선, 리사이즈 핸들 대각 영역 확장, 텍스트 잘림 방지 padding
- **2-K** 블록 클릭/드래그 판별 개선 — `click` 이벤트에서 마우스 이동 거리(`DRAG_DISTANCE_PX`) 체크 추가, 드래그 후 의도치 않은 모달 열림 방지

보류 항목:
- ~~대각선 셀 클릭으로 5분 단위 선택~~ — 셀 크기가 작아 정밀 클릭이 비현실적이고 UX가 번잡해짐. 향후 Shift+드래그 등 대안 검토.

## 미완료 Phase (SPEC.md 참조)

- **Phase 3**: Planning workflow (인박스, 프로젝트 통합)
- **Phase 4**: Review & 통계
- **Phase 5**: 외부 캘린더 & 커맨드
- **Phase 6**: 모바일 최적화

## 파일 구조 및 역할

```
src/
├── types.ts              # TimelineItem, WeekFlowSettings, ParseResult 등 타입 정의
├── parser.ts             # 마크다운 ↔ TimelineItem 파싱/직렬화, generateItemId()
├── daily-note.ts         # 데일리 노트 읽기/쓰기, getWeekDates(), loadWeekData()
├── grid-renderer.ts      # CSS Grid 렌더링, 드래그 상태머신, 리사이즈, 고스트 블록, 5분 대각선
├── view.ts               # WeekFlowView (ItemView) — 메인 뷰 컨트롤러, 콜백, 동기화, undo
├── main.ts               # 플러그인 엔트리포인트, 커맨드 등록
├── block-modal.ts        # 새 블록 생성 모달
├── edit-block-modal.ts   # 기존 블록 편집/삭제 모달 (Phase 2 신규)
├── undo-manager.ts       # UndoableAction 인터페이스 + UndoManager 클래스 (Phase 2 신규)
└── settings.ts           # 설정 탭 UI
styles.css                # 전체 CSS (그리드, 블록, 고스트, 리사이즈 핸들, 대각선, 경고 배너 등)
```

## 주요 아키텍처 결정사항

1. **데이터는 데일리 노트에만 존재** — WeekFlow는 뷰 레이어일 뿐
2. **TimelineItem.id는 메모리 전용** — 파싱할 때마다 새로 부여, 마크다운에 저장하지 않음
3. **드래그 상태머신**: `none` → `cell-select` | `block-drag` | `resize` → `none`
4. **getCellFromPoint()**: 셀 순회 대신 그리드 geometry 수학 계산 (성능 이슈로 교체됨)
5. **고스트 블록**: 단일 element가 아닌 배열 (`ghostEls`, `resizeGhostEls`)로 다중 hour-row 세그먼트 표현
6. **리사이즈 핸들**: 좌(시작시간)/우(종료시간) 방향 — 시간이 가로로 흐르므로
7. **Undo**: `pushExecuted()` 패턴 — 작업 실행 후 undo 액션만 등록 (execute()는 비어있음)
8. **5분 대각선**: `clip-path: polygon()`으로 블록 엣지를 대각선으로 자르고, `::before`/`::after` pseudo-element에 `linear-gradient`로 경계선 렌더링. `--slots` CSS custom property로 세그먼트 폭에 비례한 대각선 크기 계산.

## 개발 환경

Obsidian vault(`PuerCete`)에 심링크 설정 완료:
```
~Documents/PuerCete/.obsidian/plugins/weekflow → ~/repo/obsidian-weekflow
```
`npm run build` 후 Obsidian에서 Cmd+R로 즉시 반영.

## 빌드 & 테스트

```bash
npm install
npm run build        # esbuild production build
npm run dev          # 개발 모드 (hot reload)
```

현재 상태: 빌드 통과 (clean).

## 알려진 이슈 / 개선 여지

- `getCellFromPoint()` 수학 계산에서 스크롤 위치 반영이 정확한지 실사용 검증 필요
- 블록 드래그 시 150ms 딜레이 + 5px 이동 임계값으로 클릭/드래그 구분 — 체감 조정 가능
- Undo 시 `weekData` 메모리 상태와 파일 상태가 동기화되지만, 외부 수정이 끼어들면 undo가 꼬일 수 있음
- 자정 넘김 분리는 주의 마지막 날(dayIndex=6)에서는 동작하지 않음 (다음 주로 넘어가는 케이스)
- `clip-path` 적용 시 해당 블록의 `border-radius: 3px`이 무시됨 — 대각선 자체가 시각적 구분을 제공하므로 허용 가능
