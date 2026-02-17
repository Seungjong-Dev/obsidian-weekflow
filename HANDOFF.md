# WeekFlow 작업 핸드오프

> 작성일: 2026-02-17
> 마지막 커밋: `ee5eea4` fix: review panel toggle — clear inline styles before collapse

## 프로젝트 개요

WeekFlow는 Obsidian 플러그인으로, 데일리 노트의 마크다운 체크박스 리스트를 주간 타임테이블 그리드로 시각화한다. `SPEC.md`에 전체 스펙이 정의되어 있고, `CLAUDE.md`에 개발 가이드가 있다.

## 완료된 Phase

### Phase 1 (Core MVP)
- 주간 타임테이블 그리드 렌더링 (10분 단위 셀, CSS Grid)
- 데일리 노트 파싱/직렬화 (Tasks 플러그인 메타데이터 보존)
- 셀 드래그로 블록 생성 → BlockModal → 데일리 노트 저장
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
- 블록 정렬: 시간순 컴팩션 (Plan 블록만, 주 전체, Undo 지원)
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

## 미완료 Phase (SPEC.md 참조)

- **Phase 5**: 외부 캘린더 & 커맨드
- **Phase 6**: 모바일 최적화

## 파일 구조 및 역할

```
src/
├── types.ts              # TimelineItem, WeekFlowSettings, CategoryStats, PlanActualSummary 등 타입
├── parser.ts             # 마크다운 ↔ TimelineItem 파싱/직렬화, Review 섹션 파싱/업데이트
├── daily-note.ts         # 데일리 노트 읽기/쓰기, 인박스 I/O, 프로젝트 I/O, 리뷰 I/O
├── grid-renderer.ts      # CSS Grid 렌더링, 드래그 상태머신, 리사이즈, 헤더 더블클릭 콜백
├── view.ts               # WeekFlowView — 메인 뷰 컨트롤러, 리뷰 패널, 리사이즈, 데일리 노트 네비게이션
├── planning-panel.ts     # PlanningPanel — overdue/inbox/project 섹션 렌더링, 접기/펼치기
├── statistics.ts          # 통계 계산 (카테고리, 프로젝트, Plan vs Actual, Burning Rate, 시간 분포)
├── stats-view.ts          # StatsView (ItemView) — 통계 뷰, 범위 선택, 차트 렌더링
├── stats-cache.ts         # StatsCache — mtime 기반 증분 파싱 캐시
├── main.ts               # 플러그인 엔트리포인트, 커맨드 등록, StatsView 등록
├── block-modal.ts        # 새 블록 생성 모달
├── edit-block-modal.ts   # 기존 블록 편집/삭제/완료토글 모달
├── confirm-modal.ts      # Yes/No 확인 다이얼로그
├── preset-modal.ts       # CreatePresetModal, ApplyPresetModal, PresetModal
├── undo-manager.ts       # UndoableAction + UndoManager (50개 제한)
└── settings.ts           # 설정 탭 UI (기본 + Planning + Project + Presets + Categories + Review)
styles.css                # 전체 CSS (그리드, 리뷰 패널, 통계 뷰, 차트)
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
- 인박스에서 제거 시 Undo 미지원 (Phase 3 보류 항목)
