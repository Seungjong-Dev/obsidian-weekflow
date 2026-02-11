# WeekFlow 작업 핸드오프

> 작성일: 2026-02-11
> 마지막 커밋: `44141fa` feat: implement Phase 3 remainder — project integration, block sorting, presets

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

## 미완료 Phase (SPEC.md 참조)

- **Phase 4**: Review & 통계
- **Phase 5**: 외부 캘린더 & 커맨드
- **Phase 6**: 모바일 최적화

## 파일 구조 및 역할

```
src/
├── types.ts              # TimelineItem, WeekFlowSettings, PresetSlot/TimeSlotPreset, PanelItem 등 타입
├── parser.ts             # 마크다운 ↔ TimelineItem 파싱/직렬화, generateItemId(), extractBlockId(), generateBlockId()
├── daily-note.ts         # 데일리 노트 읽기/쓰기, 인박스 I/O, 프로젝트 I/O (getActiveProjects, getProjectTasks, completeProjectTask)
├── grid-renderer.ts      # CSS Grid 렌더링, 드래그 상태머신, 리사이즈, 고스트 블록, 5분 대각선, 완료 토글
├── view.ts               # WeekFlowView — 메인 뷰 컨트롤러, 패널/그리드 통합, 정렬, 프리셋, undo
├── planning-panel.ts     # PlanningPanel — overdue/inbox/project 섹션 렌더링, 접기/펼치기
├── main.ts               # 플러그인 엔트리포인트, 커맨드 등록
├── block-modal.ts        # 새 블록 생성 모달
├── edit-block-modal.ts   # 기존 블록 편집/삭제 모달 (Actual 시간 편집 포함)
├── confirm-modal.ts      # Yes/No 확인 다이얼로그 (프로젝트 태스크 완료 동기화 용)
├── preset-modal.ts       # CreatePresetModal, ApplyPresetModal, PresetModal
├── undo-manager.ts       # UndoableAction + UndoManager (50개 제한)
└── settings.ts           # 설정 탭 UI (기본 + Planning Panel + Project Integration + Presets + Categories)
styles.css                # 전체 CSS
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
