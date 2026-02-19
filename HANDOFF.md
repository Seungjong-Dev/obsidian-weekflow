# WeekFlow 작업 핸드오프

> 작성일: 2026-02-18
> 마지막 커밋: `38539a7` fix: use timezone-aware JS Date comparison for calendar event filtering

## 프로젝트 개요

WeekFlow는 Obsidian 플러그인으로, 데일리 노트의 마크다운 체크박스 리스트를 주간 타임테이블 그리드로 시각화한다. `SPEC.md`에 전체 스펙이 정의되어 있고, `CLAUDE.md`에 개발 가이드가 있다.

## 완료된 Phase

### Phase 1 (Core MVP)
- 주간 타임테이블 그리드 렌더링 (10분 단위 셀, CSS Grid)
- 데일리 노트 파싱/직렬화 (Tasks 플러그인 메타데이터 보존)
- 셀 드래그로 블록 생성 → BlockModal (시간 편집 가능) → 데일리 노트 저장
- 통합 뷰 (Plan/Actual 동시 표시, 날짜 기준 자동 결정)
- 카테고리 팔레트, 주간 네비게이션, 설정 탭

### Phase 2 (Block Editing & Sync)
- TimelineItem에 런타임 `id: string` 추가 (마크다운에는 저장 안 함)
- EditBlockModal — 블록 편집 + 삭제, Actual 블록은 planTime 읽기 전용 + actualTime 편집
- 블록 완료 토글 (○/✓ 버튼으로 Plan ↔ Actual 전환)
- 블록 드래그 이동 (같은 날 + 크로스데이), Actual 블록은 actualTime만 변경
- 블록 좌/우 경계 리사이즈, Actual 블록은 actualTime만 변경
- 양방향 동기화 (`vault.on('modify')` + `active-leaf-change`, `isSelfWriting` 가드, 300ms debounce)
- 5분 단위 입력 + 대각선 렌더링 (`clip-path`, `::before`/`::after`)
- 자정 넘김 자동 분리 (overnight)
- Undo/Redo 스택 (Command pattern, 50개 제한, Mod+Z / Mod+Shift+Z)
- 에러 핸들링 (경고 배너, 시간 겹침 반투명 오버랩)
- 블록 우클릭 컨텍스트 메뉴 (Obsidian `Menu`): Edit / Mark as Done(or Incomplete) / Delete
- EditBlockModal 완료 토글 버튼: Plan → "Mark as Done", Actual → "Mark as Incomplete", Deferred → 미표시

보류 항목:
- ~~대각선 셀 클릭으로 5분 단위 선택~~ — 셀 크기가 작아 비현실적. 향후 Shift+드래그 등 대안 검토.

### Phase 3 (Planning Workflow)
- Planning Panel (사이드바, 토글 가능, 상태 저장)
- 미완료(Overdue) 수집: 현재 주의 과거 날짜에서 `- [ ]` 항목 표시
- 인박스 연동: 설정된 인박스 노트에서 미완료 태스크 읽기, 드래그→그리드 배치, 인박스에서 제거
- Deferred 처리: 과거 날짜 이동 시 `- [>]`, 오늘/미래는 단순 이동
- 인박스로 되돌리기: 블록을 그리드 밖으로 드래그 시 인박스에 반환
- 프로젝트 태스크 연동: `metadataCache`로 활성 프로젝트 탐색, 미완료 태스크 패널 표시
- 프로젝트 드래그 배치: block ID 자동 부여 + `[[Project#^block-id]]` 링크 포함
- 완료 시 원본 동기화: `[[...#^...]]` 감지 → ConfirmModal → 프로젝트 노트 `- [x]` 변환
- ~~블록 정렬~~: 제거됨 (Phase 6에서 툴바 정리 시 삭제)
- 타임 슬롯 프리셋: 현재 날짜에서 생성, 요일 선택 적용, 덮어쓰기/병합, Undo 지원

### Phase 4 (Review & Statistics)
- **Daily Review Panel**: 타임테이블 하단에 7칸 리뷰 패널, 날짜 칼럼과 정렬
  - 인라인 textarea 편집, 300ms debounce 저장 + blur 즉시 저장
  - 토글 버튼으로 접기/펼치기, 상태 저장
  - 드래그 리사이즈 핸들 (min 60px, max 500px, 높이 설정 저장)
  - `scrollbar-gutter: stable`로 그리드-리뷰 칼럼 정렬
  - Review 헤딩 자동 삽입 (Timeline 섹션 바로 뒤에 위치)
- **Statistics View**: 별도 ItemView 탭 (`weekflow-stats-view`)
  - 카테고리별 Plan/Actual 시간 + 달성률 프로그레스 바
  - 프로젝트별 시간 집계
  - Plan vs Actual 요약 카드 (Completion Rate, Deferred Rate, Unplanned Actuals)
  - 다중 범위: Weekly / Monthly / Quarterly / Yearly
  - 범위별 네비게이션 (◀ ▶ Today)
  - Burning Rate 추이 차트 (스택형 바 차트, 순수 HTML/CSS)
  - 시간 분포 차트 (가로 막대)
  - 증분 파싱 캐시 (`StatsCache`, `mtime` 기반 캐시 히트)
- **Daily Note Navigation**
  - 날짜 헤더 더블클릭 → 데일리 노트 열기
  - 블록 우클릭 메뉴 "Go to daily note" → 해당 라인에 커서 위치

### Phase 5 (External Calendar & Commands)
- **ICS Calendar Overlay**: `ical.js` 라이브러리로 ICS 파싱, `requestUrl` (Obsidian API)로 CORS 우회 페칭
  - 인메모리 캐시 (`Map<url, { text, fetchedAt }>`) + stale cache fallback (오프라인 대응)
  - 반복 이벤트 확장 (`Event.iterator()`, MAX_EXPANSIONS=365)
  - `Promise.allSettled()`로 소스별 독립 처리 (한 소스 실패가 전체를 막지 않음)
  - All-day 이벤트 스킵, 주간 범위 클리핑
  - 비동기 로딩: 뷰 렌더 후 백그라운드 fetch → `renderCalendarOverlayOnly()`로 오버레이만 패치 (뷰 먹통 방지)
  - 새로고침(↻) 버튼 클릭 시 `clearCalendarCache()` 호출하여 캐시 강제 초기화 후 refetch (자동 갱신에서는 캐시 유지)
- **렌더링**: 빗금 패턴(`repeating-linear-gradient`) + 점선 테두리, z-index 2 (타임라인 블록 아래), `pointer-events: none` (셀 클릭/드래그 통과), 네이티브 `title` 툴팁
- **설정 UI**: Calendar Sources 섹션 (name/URL/color/enabled/delete per source, cache duration slider 0~120분)
- **"Go to this week" 커맨드**: `checkCallback`으로 WeekFlowView 활성 시에만 동작

### Phase 6 (Responsive UI & Mobile)
- **`src/device.ts` (신규)**: DeviceTier, LayoutTier 타입 + 유틸리티 (`getLayoutTier`, `getVisibleDays`, `isTouchDevice`, `hapticFeedback`)
- **너비 기반 3-tier 레이아웃**: Wide(≥900px, 7일) / Medium(500~899px, 3일) / Narrow(<500px, 1일)
- `ResizeObserver`로 `.weekflow-container` 너비 실시간 감시 → `onLayoutTierChanged()` → 자동 브레이크포인트 전환
- **Pointer Events 전환**: 모든 `mousedown/mousemove/mouseup` → `pointerdown/pointermove/pointerup` (마우스+터치+펜 통합)
- `setPointerCapture()`로 리사이즈 핸들 드래그 안정화
- **동적 visibleDays/dayOffset**: `GridRenderer.setVisibleRange()`, 그리드 칼럼·헤더·셀·블록·캘린더 오버레이 모두 표시 범위에 맞게 렌더
- **터치 셀 선택 (탭-탭)**: 터치 디바이스에서 드래그→스크롤/스와이프 전용으로 해방, 셀 선택은 탭-탭 방식으로 변경
  - `e.pointerType === "touch"` 분기: 터치는 `touchTapState`로 탭-탭, 마우스는 기존 드래그 유지
  - 첫 탭: 앵커 셀 설정 + 하이라이트, 두 번째 탭(같은 요일): 범위 확장 → 모달 열기
  - 같은 셀 재탭: 단일 셀 블록 생성, 다른 요일 탭: 기존 선택 취소 → 새 앵커
  - `pointercancel` 핸들러에서 스와이프 감지 (`touch-action: pan-y`로 인한 브라우저 `pointercancel` 대응)
- **스와이프 네비게이션**: 가로 >50px, |dx|>|dy|×2, <300ms → 1일/3일 뷰에서 날짜 이동, Wide+터치에서 주 이동
- **Obsidian 사이드바 차단**: 그리드 `touchstart`/`touchmove` 리스너에서 가로 이동 >15px 시 `stopPropagation()` (Obsidian 사이드바 스와이프 방지)
- **3일 뷰 고정 페이지**: 페이지 [0,2,4] (Mon-Wed / Wed-Fri / Fri-Sun), 2일 스텝 + 1일 오버랩, Today 버튼은 과거 맥락 우선 (earlier page). 주 경계 넘기: ◀→이전 주 page[4], ▶→다음 주 page[0] (`pendingDayOffset`)
- **Today 방향 힌트**: 오늘이 현재 뷰 범위 밖일 때 오늘 방향의 ◀/▶ 및 Today 버튼에 accent dot 표시 (`.weekflow-nav-today-hint::after`)
- **롱프레스 드래그**: 터치 300ms / 마우스 150ms, `weekflow-longpress-active` scale 피드백 + 햅틱 진동
- **하단 시트 (Narrow)**: Planning Panel을 bottom sheet로 표시 (collapsed/expanded, 스와이프 핸들)
- **패널 토글 수정**: Medium 모드 CSS specificity 수정 (`.weekflow-layout-medium .weekflow-panel.collapsed`), Narrow 모드에서 `bottomSheetEl` 토글 추가
- **툴바 2행 구조**: Row 1 (네비게이션 ◀/▶ + 도구 버튼 + 오버플로우 ⋯), Row 2 (스크롤 가능한 팔레트)
  - ◀/▶ 컨텍스트 인식: 7일 뷰에서는 주 이동, sub-7일 뷰에서는 일/페이지 이동
  - 오버플로우 메뉴: `ResizeObserver`로 넘치는 버튼 감지 → Obsidian `Menu`에 수집
  - Sort 버튼 제거, 모든 도구 버튼 `setIcon()` 사용
- **CSS 터치 최적화**: `@media (pointer: fine)` hover 격리, `@media (pointer: coarse)` 상시 표시 토글/핸들, `.weekflow-grid`/`.weekflow-block` `touch-action: pan-y` (블록 위에서도 스크롤 허용, 롱프레스 시 `setPointerCapture`로 드래그 전환), `.weekflow-resize-handle`은 `touch-action: none` 유지, 터치 타겟 36px (툴바)
- **모바일 하단 바 대응**: `.is-mobile` 컨테이너에 `env(safe-area-inset-bottom)`, 그리드 `padding-bottom: 48px`, 바텀 시트 `bottom: 48px` 오프셋 (Obsidian 네비 바 위로 배치), narrow+mobile 그리드 패딩 96px
- **Apple Pencil 대응**: `pointercancel` 시 `dragMode` 리셋 (호버 고스트 선택 방지), `getCellFromPoint()` 스크롤 이중 가산 수정
- **페이지 이동 최적화**: 같은 주 내 이동은 `updatePage()` (그리드+툴바+리뷰만 갱신), 프로젝트 데이터는 `loadProjectDataAsync()`로 비동기 로드, `renderView()` 전 `GridRenderer.destroy()` 호출 (리스너 누수 방지)
- **카테고리 팔레트 → 모달 연동**: `selectedCategory`를 `BlockModal`에 `defaultTag`로 전달, 미선택 시 첫 번째 카테고리 자동 선택
- **기본 카테고리**: Work, Personal 2개 (기존 5개에서 축소)
- Review Panel 칼럼 수 visibleDays 연동
- Statistics 뷰 좁은 화면 세로 배치

### Inbox 소스 리디자인
- **배경**: 기존 inbox는 `inboxNotePath`에 moment.js 동적 경로를 지원하여 주가 바뀌면 이전 inbox의 미완료 항목이 사라지는 문제 → 정적 다중 소스 모델로 교체
- **`types.ts`**: `InboxSource` 인터페이스 추가 (`{ path: string; heading: string }`), `inboxNotePath`/`inboxHeading` 제거 → `inboxSources: InboxSource[]` 배열로 교체, 기본값 `[{ path: "Inbox.md", heading: "" }]`
- **`parser.ts`**: `parseCheckboxItems()`가 빈 heading 문자열 수용 → 파일 전체 파싱
- **`daily-note.ts`**: `resolveInboxNotePath()` 제거 (moment 의존 제거). 새 함수: `getInboxItems()` (모든 소스 순회, 노트/폴더 대응), `getInboxWatchPaths()` (파일 변경 감지용), `addToInbox()` (우선순위 1위 노트 소스에 쓰기), `removeFromInboxFile()` (파일+라인 기반 제거), `getPrimaryInboxNoteSource()` 헬퍼, `collectMarkdownFiles()` (재귀 폴더 스캔)
- **`settings.ts`**: Inbox Sources 리스트 UI — path+heading 입력, 드래그 리오더(우선순위), Note/Folder 자동 감지, 추가/삭제 버튼
- **`view.ts`**: 모든 inbox 참조를 다중 소스 기반으로 변경, `InboxCheckboxItem`에 `sourcePath` 추가, `onInboxAddItem()` 핸들러 추가
- **`planning-panel.ts`**: 인박스 섹션에 새 항목 추가 입력 UI, 소스가 여러 개일 때 소스 경로 라벨 표시
- **`main.ts`**: 플러그인 로드 시 기존 `inboxNotePath`/`inboxHeading` → `inboxSources`로 자동 마이그레이션
- **`styles.css`**: 설정 UI (inbox source rows, drag reorder) 및 패널 add-item input, source path label 스타일 추가

## 미완료 Phase

모든 Phase (1~6) 및 Inbox 리디자인 완료. SPEC.md 참조.

## 파일 구조 및 역할

```
src/
├── types.ts              # TimelineItem, WeekFlowSettings, InboxSource, CategoryStats, PlanActualSummary, SwipeCallbacks 등 타입
├── parser.ts             # 마크다운 ↔ TimelineItem 파싱/직렬화, Review 섹션 파싱/업데이트
├── daily-note.ts         # 데일리 노트 읽기/쓰기, 인박스 다중 소스 I/O, 프로젝트 I/O, 리뷰 I/O
├── device.ts             # DeviceTier, LayoutTier, getLayoutTier(), getVisibleDays(), isTouchDevice(), hapticFeedback()
├── grid-renderer.ts      # CSS Grid 렌더링, Pointer Events 드래그 상태머신, 리사이즈, 스와이프 감지, visibleDays/dayOffset 동적화
├── view.ts               # WeekFlowView — 메인 뷰 컨트롤러, ResizeObserver + LayoutTier, 리뷰 패널, 하단 시트, 데일리 노트 네비게이션
├── planning-panel.ts     # PlanningPanel — overdue/inbox/project 섹션 렌더링, 접기/펼치기
├── statistics.ts          # 통계 계산 (카테고리, 프로젝트, Plan vs Actual, Burning Rate, 시간 분포)
├── stats-view.ts          # StatsView (ItemView) — 통계 뷰, 범위 선택, 차트 렌더링
├── stats-cache.ts         # StatsCache — mtime 기반 증분 파싱 캐시
├── calendar.ts           # ICS 페칭/파싱/캐시 (ical.js 사용, requestUrl, Promise.allSettled)
├── ical.d.ts             # ical.js 최소 TypeScript 타입 선언
├── main.ts               # 플러그인 엔트리포인트, 커맨드 등록, StatsView 등록, inbox 설정 자동 마이그레이션
├── block-modal.ts        # 새 블록 생성 모달 (시간 편집 가능, step=300)
├── edit-block-modal.ts   # 기존 블록 편집/삭제/완료토글 모달
├── confirm-modal.ts      # Yes/No 확인 다이얼로그
├── preset-modal.ts       # CreatePresetModal, ApplyPresetModal, PresetModal
├── undo-manager.ts       # UndoableAction + UndoManager (50개 제한)
└── settings.ts           # 설정 탭 UI (기본 + Planning + Inbox Sources + Project + Calendar Sources + Presets + Categories + Review)
styles.css                # 전체 CSS (그리드, 캘린더 오버레이, 리뷰 패널, 통계 뷰, 차트, 반응형 @media, touch-action, 하단 시트)
```

## 주요 아키텍처 결정사항

1. **데이터는 데일리 노트에만 존재** — WeekFlow는 뷰 레이어일 뿐
2. **TimelineItem.id는 메모리 전용** — 파싱할 때마다 새로 부여, 마크다운에 저장하지 않음
3. **드래그 상태머신**: `none` → `cell-select` | `block-drag` | `resize` → `none`
4. **getCellFromPoint()**: 셀 순회 대신 그리드 geometry 수학 계산 (성능 이슈로 교체됨)
5. **고스트 블록**: 단일 element가 아닌 배열 (`ghostEls`, `resizeGhostEls`)로 다중 hour-row 세그먼트 표현
6. **리사이즈 핸들**: 좌(시작시간)/우(종료시간) 방향 — 시간이 가로로 흐르므로
7. **Undo**: `pushExecuted()` 패턴 — 작업 실행 후 undo 액션만 등록 (execute()는 비어있음)
8. **5분 대각선**: `clip-path: polygon()`으로 블록 엣지를 대각선으로 자르고, `::before`/`::after` pseudo-element에 `linear-gradient`로 경계선 렌더링
9. **레이아웃 계층**: `.weekflow-body` → `.weekflow-main` (panel + content-area) → `.weekflow-content-area` (grid + review). 리뷰 패널이 그리드와 동일 너비를 공유하도록 content-area 래퍼 사용
10. **scrollbar-gutter: stable**: 그리드와 리뷰 패널 모두에 적용하여 스크롤바 유무와 무관하게 칼럼 정렬 유지
11. **리뷰 리사이즈**: 마우스 드래그 핸들, inline style로 높이 제어. 토글 시 inline style 제거 후 collapsed 클래스 적용 (우선순위 충돌 방지)
12. **Statistics 뷰**: 별도 ItemView (패널이 아닌 독립 탭). 순수 HTML/CSS 차트 (외부 라이브러리 없음). `StatsCache`로 대규모 범위(연간 등) 성능 최적화
13. **캘린더 비동기 로딩**: `refresh()`에서 로컬 데이터만 `Promise.all()`로 로드 → `renderView()` → `loadCalendarEventsAsync()`로 ICS를 백그라운드 fetch → `renderCalendarOverlayOnly()`로 기존 그리드에 오버레이만 패치. 네트워크 I/O가 뷰 렌더링을 블로킹하지 않음
14. **캘린더 오버레이 비간섭**: `pointer-events: none`으로 캘린더 이벤트가 셀 클릭/드래그를 막지 않음. 캘린더 일정 위에서도 블록 생성 가능
15. **모달 시간 입력**: BlockModal/EditBlockModal 모두 `<input type="time" step="300">` + `input` 이벤트 사용 (`change` 이벤트는 Obsidian 모달 내에서 불안정)
16. **너비 기반 레이아웃**: 디바이스 타입이 아닌 뷰 컨테이너 너비(`ResizeObserver`)로 레이아웃 결정. 데스크톱 창 리사이즈·iPad Split View·오리엔테이션 전환을 하나의 로직으로 처리
17. **Pointer Events 통합**: 모든 인터랙션을 `pointerdown`/`pointermove`/`pointerup`으로 구현. `setPointerCapture()`로 요소 밖 드래그 유지. 터치 롱프레스(300ms) vs 마우스 딜레이(150ms) 분기. `onGlobalPointerMove`에서 `cell-select` 모드를 처리하여 터치 드래그 시 `getCellFromPoint()`로 다중 셀 선택 (`pointerenter`는 터치에서 미발생)
18. **visibleDays/dayOffset**: GridRenderer가 항상 7일분 데이터를 보유하되, 표시 범위만 `dayOffset ~ dayOffset + visibleDays - 1`로 제한. 칼럼 위치는 `(dayIndex - dayOffset) * 6 + 2`로 계산
19. **하단 시트 패턴**: Narrow 모드에서 사이드 패널을 하단 시트로 교체. `transform: translateY()`로 collapsed/expanded 전환, PlanningPanel 컴포넌트 재사용
20. **터치 탭-탭 상태머신**: `touchTapState`로 터치 셀 선택을 2단계 탭으로 처리. `pointerdown`에서 `e.pointerType`으로 분기 — 터치는 `preventDefault()` 호출 안 함 (네이티브 스크롤 허용), 마우스는 기존 드래그 선택. `pointercancel`에서도 스와이프 감지 수행 (`touch-action: pan-y`로 인해 세로 스크롤 시 브라우저가 `pointercancel` 발생)
21. **3일 뷰 고정 페이지**: `calculateDayOffset()`에서 `pages = [0, 2, 4]` 고정 배열 사용. 2일 스텝 + 1일 오버랩 (Mon-Wed / Wed-Fri / Fri-Sun). Today 버튼은 오버랩 날짜에서 earlier page 선택 (과거 맥락 우선)
22. **툴바 오버플로우**: `ResizeObserver`로 `.weekflow-toolbar-tools` 내 버튼 가시성 감지 → 넘치는 버튼을 Obsidian `Menu`로 수집하여 `⋯` 버튼에 표시. `⋯` 버튼은 `tools` 컨테이너 바깥에 배치 (내부에 두면 공간 변동으로 무한 토글 발생)
23. **Obsidian 사이드바 차단**: 그리드에 `touchstart`/`touchmove` 이벤트 리스너를 등록하여 가로 이동이 15px 초과 시 `stopPropagation()` 호출. Obsidian의 사이드바 스와이프 제스처 차단. WeekFlow 자체 스와이프는 `handleTouchPointerUp`에서 별도 처리

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

## 다음 작업

모든 기능 구현 완료. SPEC.md 참조.

## 알려진 이슈 / 개선 여지

- ~~`getCellFromPoint()` 수학 계산에서 스크롤 위치 반영이 정확한지 실사용 검증 필요~~ — 해결: `getBoundingClientRect()`가 스크롤을 이미 반영하므로 `scrollLeft/Top` 이중 가산 제거
- 블록 드래그 시 150ms(데스크톱)/300ms(터치) 딜레이 + 5px 이동 임계값으로 클릭/드래그 구분 — 체감 조정 가능
- Undo 시 `weekData` 메모리 상태와 파일 상태가 동기화되지만, 외부 수정이 끼어들면 undo가 꼬일 수 있음
- 자정 넘김 분리는 주의 마지막 날(dayIndex=6)에서는 동작하지 않음 (다음 주로 넘어가는 케이스)
- `clip-path` 적용 시 해당 블록의 `border-radius: 3px`이 무시됨 — 대각선 자체가 시각적 구분을 제공하므로 허용 가능
- 인박스에서 제거 시 Undo 미지원 (Phase 3 보류 항목)
