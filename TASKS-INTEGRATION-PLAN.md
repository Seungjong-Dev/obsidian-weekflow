# WeekFlow × Tasks Plugin 통합 기획서

## 현황 분석

### 현재 구현 상태

WeekFlow는 Tasks 플러그인의 이모지 메타데이터를 **rawSuffix로 보존**하는 수준의 호환성만 갖고 있다.

| 항목 | 현재 상태 |
|------|----------|
| 메타데이터 보존 (round-trip) | ✅ 구현 완료 |
| 메타데이터 구조화 파싱 | ❌ 없음 (문자열로만 저장) |
| 완료 시 `✅` 날짜 자동 추가 | ❌ 없음 |
| 반복 태스크 처리 | ❌ 없음 |
| 우선순위 시각화 | ❌ 없음 |
| 마감일 기반 경고 | ❌ 없음 |
| Tasks 쿼리 결과 연동 | ❌ 없음 |

### 지원하는 Tasks 이모지 패턴 (파서 인식)

```
📅 YYYY-MM-DD  마감일 (due date)
⏳ YYYY-MM-DD  예정일 (scheduled date)
🛫 YYYY-MM-DD  시작일 (start date)
✅ YYYY-MM-DD  완료일 (done date)
⏫ / 🔼 / 🔽   우선순위 (high / medium / low)
🔁 every ...   반복 규칙 (recurrence)
➕ YYYY-MM-DD  생성일 (created date)
🔄 YYYY-MM-DD  취소일 (cancelled date) — Tasks 7.x
⛔ ...         의존성 (depends on)
🆔 ...         태스크 ID
🏷️ ...         커스텀 라벨
```

---

## 기획 방향

**핵심 원칙:** WeekFlow의 시간 관리 맥락에서 Tasks 메타데이터를 **능동적으로 활용**하되, Tasks 플러그인과의 **데이터 호환성을 절대 깨뜨리지 않는다.**

### 우선순위 기준

1. **높음** — 사용자가 매일 체감하는 기능, 구현 난이도 낮음
2. **중간** — 워크플로우를 크게 개선하지만 구현이 복잡
3. **낮음** — 있으면 좋지만 핵심은 아님

---

## Feature 1: 완료 시 Done Date 자동 관리 (우선순위: 높음)

### 문제

WeekFlow에서 블록을 `- [x]`로 완료 처리해도 Tasks 플러그인의 `✅ YYYY-MM-DD` 메타데이터가 추가되지 않는다. Tasks 쿼리에서 완료 처리가 인식되지 않음.

### 기획

**동작:**
- Plan → Actual 전환 시(`- [ ]` → `- [x]`): `rawSuffix`에 `✅ YYYY-MM-DD` 자동 추가
- Actual → Plan 복귀 시(`- [x]` → `- [ ]`): `✅ YYYY-MM-DD` 자동 제거
- 이미 `✅`가 있으면 날짜만 갱신

**날짜 결정 규칙:**
- 완료일 = 해당 블록이 속한 데일리 노트의 날짜 (오늘 날짜가 아님)
  - 예: 2026-03-25(화)의 블록을 03-27(목)에 완료 처리 → `✅ 2026-03-25`

**설정:**
```typescript
tasksAutoCompletionDate: boolean  // default: true
```

### 영향 범위

- `block-actions.ts` — toggleCompletion 로직
- `parser.ts` — rawSuffix 조작 유틸리티 함수 추가

### 예시

```markdown
// Before: Plan 블록
- [ ] 09:00-11:00 API 설계 #work 📅 2026-03-28 ⏫

// After: 완료 토글 (WeekFlow에서 03-25 날짜의 블록)
- [x] 09:00-11:00 API 설계 #work 📅 2026-03-28 ⏫ ✅ 2026-03-25
```

---

## Feature 2: 반복 태스크 자동 생성 (우선순위: 높음)

### 문제

`🔁 every day` 등의 반복 규칙이 있는 태스크를 완료해도, 다음 인스턴스가 자동 생성되지 않는다. 사용자가 수동으로 다음 날에 복사해야 함.

### 기획

**동작:**
- `🔁` 메타데이터가 있는 블록 완료 시:
  1. 현재 블록 `- [x]` 처리 + `✅` 추가 (Feature 1)
  2. 반복 규칙에 따라 다음 날짜 계산
  3. 다음 날짜의 데일리 노트에 새 `- [ ]` 항목 자동 생성
  4. 새 항목에서 `✅` 제거, 나머지 메타데이터 유지
  5. 확인 모달로 사용자에게 생성 여부/날짜 확인

**지원 반복 규칙 (Tasks 플러그인 호환):**

| 규칙 | 다음 날짜 계산 |
|------|--------------|
| `🔁 every day` | +1일 |
| `🔁 every week` | +7일 |
| `🔁 every month` | 다음 달 같은 날 |
| `🔁 every week on Monday` | 다음 주 월요일 |
| `🔁 every weekday` | 다음 평일 |

**설정:**
```typescript
tasksRecurrenceEnabled: boolean       // default: true
tasksRecurrenceConfirmation: boolean  // default: true (모달 확인)
```

### 영향 범위

- `parser.ts` — 반복 규칙 파싱 함수 추가
- `block-actions.ts` — 완료 시 반복 태스크 처리 로직
- `daily-note.ts` — 다음 날짜 데일리 노트에 항목 삽입
- 새 파일: `recurrence-modal.ts` — 반복 생성 확인 모달

### 예시

```markdown
// 03-25(화)의 블록 완료
- [x] 06:00-07:00 아침 운동 #exercise 🔁 every day ✅ 2026-03-25

// → 03-26(수)에 자동 생성
- [ ] 06:00-07:00 아침 운동 #exercise 🔁 every day
```

---

## Feature 3: 우선순위 시각 표시 (우선순위: 높음)

### 문제

`⏫`(높음), `🔼`(중간), `🔽`(낮음) 우선순위가 있어도 타임테이블에서 시각적 구분이 없다.

### 기획

**시각 표현:**

| 우선순위 | 블록 표시 | 패널 표시 |
|---------|----------|----------|
| `⏫` 높음 | 블록 좌측에 빨간 세로 바 (3px) | 아이템 앞에 `⏫` 표시 + 정렬 1순위 |
| `🔼` 중간 | 블록 좌측에 주황 세로 바 (3px) | 아이템 앞에 `🔼` 표시 + 정렬 2순위 |
| `🔽` 낮음 | 블록 좌측에 파란 세로 바 (3px) | 아이템 앞에 `🔽` 표시 + 정렬 3순위 |
| 없음 | 변화 없음 | 정렬 4순위 |

**Planning Panel 정렬:**
- 패널 아이템을 우선순위 순으로 정렬 (같은 우선순위 내에서는 마감일 → 이름 순)

**구현:**
- `rawSuffix`에서 우선순위 이모지만 추출하여 `TimelineItem`에 구조화 필드로 저장
- CSS 클래스: `.weekflow-priority-high`, `.weekflow-priority-medium`, `.weekflow-priority-low`

### 영향 범위

- `types.ts` — `TimelineItem`에 `priority?: "high" | "medium" | "low"` 추가
- `parser.ts` — 우선순위 추출 로직
- `grid-renderer.ts` — 블록 렌더링에 우선순위 바 추가
- `planning-panel.ts` — 정렬 로직 추가
- `styles.css` — 우선순위 관련 스타일

---

## Feature 4: 마감일 인식 및 경고 (우선순위: 높음)

### 문제

`📅 2026-03-28`처럼 마감일이 설정된 태스크가 마감에 임박하거나 초과해도 WeekFlow에서 인지할 수 없다.

### 기획

**시각 표현:**

| 상태 | 조건 | 표시 |
|------|------|------|
| 임박 (Due Soon) | 마감일까지 1일 이내 | 블록 우상단에 `⚠` 배지, 주황색 |
| 초과 (Overdue) | 마감일 경과 + 미완료 | 블록 우상단에 `!` 배지, 빨간색 |
| 오늘 마감 | 마감일 = 오늘 | 블록 우상단에 `📅` 배지, 빨간색 |

**Planning Panel 마감일 표시:**
- 마감일이 있는 아이템 옆에 상대적 날짜 표시 (예: `D-3`, `D-Day`, `D+2`)
- 초과된 아이템은 빨간색 텍스트

**설정:**
```typescript
tasksDueDateWarning: boolean       // default: true
tasksDueDateWarningDays: number    // default: 1 (며칠 전부터 경고)
```

### 영향 범위

- `types.ts` — `TimelineItem`에 `dueDate?: string` 추가
- `parser.ts` — 마감일 추출
- `grid-renderer.ts` — 배지 렌더링
- `planning-panel.ts` — D-Day 표시 및 정렬
- `styles.css` — 배지 스타일

---

## Feature 5: Scheduled Date ↔ Timeline 날짜 동기화 (우선순위: 중간)

### 문제

Tasks 플러그인의 `⏳ YYYY-MM-DD`(scheduled date)와 WeekFlow의 타임라인 날짜가 독립적으로 존재한다. 블록을 다른 날로 이동해도 scheduled date가 갱신되지 않음.

### 기획

**동작:**
- 타임라인 블록을 다른 날짜로 드래그 이동 시:
  - `⏳` 메타데이터가 있으면 → 이동 대상 날짜로 자동 갱신
  - `⏳` 메타데이터가 없으면 → 추가하지 않음 (사용자 의도 존중)
- Planning Panel에서 그리드로 드래그 배치 시:
  - `⏳`가 있으면 → 배치 날짜로 갱신
- **역방향:** 데일리 노트에서 직접 `⏳`을 수정해도 WeekFlow는 시간 범위를 기준으로 동작하므로 충돌 없음

**설정:**
```typescript
tasksSyncScheduledDate: boolean  // default: true
```

### 영향 범위

- `block-actions.ts` — 이동 시 scheduled date 갱신 로직
- `parser.ts` — rawSuffix 내 날짜 치환 유틸리티

---

## Feature 6: 프로젝트 태스크 완료 동기화 (우선순위: 중간)

### 문제

프로젝트 노트에서 Planning Panel로 가져온 태스크를 WeekFlow에서 완료해도, 프로젝트 노트의 원본 태스크는 미완료 상태로 남는다.

### 기획

**동작:**
- 프로젝트에서 가져온 블록(source.type === "project") 완료 시:
  1. WeekFlow 블록 `- [x]` 처리
  2. 확인 모달: "프로젝트 노트의 원본 태스크도 완료 처리하시겠습니까?"
     - **예:** 프로젝트 노트의 해당 라인도 `- [x]` 처리 + `✅` 추가
     - **아니오:** WeekFlow만 완료 (프로젝트 원본은 유지)
     - **항상 동기화:** 이후 같은 세션에서 묻지 않음
  3. Block ID (`^block-id`)로 프로젝트 노트의 원본 라인 식별

**주의 사항:**
- 프로젝트 노트에 시간 범위가 없는 경우(일반 체크박스) → 체크만 변경, 시간 정보 추가하지 않음
- 양방향 동기화는 하지 않음 (프로젝트 노트에서 완료 → WeekFlow 블록 상태는 사용자가 수동 처리)

**설정:**
```typescript
tasksProjectSyncCompletion: "ask" | "always" | "never"  // default: "ask"
```

### 영향 범위

- `block-actions.ts` — 완료 시 프로젝트 동기화 로직
- `daily-note.ts` — 프로젝트 노트 라인 수정 함수
- 새 파일: `sync-modal.ts` — 동기화 확인 모달

---

## Feature 7: 의존성(Dependencies) 시각화 (우선순위: 낮음)

### 문제

Tasks 플러그인의 `⛔` (depends on) + `🆔` (task ID)로 태스크 간 의존 관계가 설정되어 있어도 타임테이블에서 확인할 수 없다.

### 기획

**동작:**
- 의존성이 있는 블록에 자물쇠 아이콘 표시 (🔒)
- 블록 hover/선택 시 의존 대상 블록 하이라이트
- 선행 태스크가 미완료이면 시각적 경고 (빗금 오버레이)

**구현 고려사항:**
- `🆔`와 `⛔`는 같은 주의 블록 간에만 시각화 (다른 주의 태스크는 로드하지 않음)
- 해당 주에 없는 의존 대상은 무시 (정보 표시는 tooltip으로)

### 영향 범위

- `types.ts` — `TimelineItem`에 `taskId?: string`, `dependsOn?: string[]` 추가
- `parser.ts` — 의존성 메타데이터 파싱
- `grid-renderer.ts` — 의존성 시각화 렌더링

---

## Feature 8: Tasks 쿼리 결과를 Planning Panel 소스로 (우선순위: 낮음)

### 문제

Tasks 플러그인의 강력한 쿼리 기능(예: `not done, due before next week, tag includes #work`)을 WeekFlow의 Planning Panel에서 활용할 수 없다.

### 기획

**동작:**
- 설정에서 Tasks 쿼리를 Planning Panel 소스로 추가 가능
- 쿼리 결과가 "Tasks Query" 섹션으로 패널에 표시됨
- 사용자가 결과를 타임라인으로 드래그하여 시간 할당

**제약:**
- Tasks 플러그인의 API가 public하지 않으므로, Tasks의 codeblock 렌더링 결과를 파싱하거나, 직접 파일을 스캔하여 쿼리를 구현해야 함
- 초기 버전은 간단한 필터만 지원:
  - `due before YYYY-MM-DD`
  - `priority is high/medium/low`
  - `tag includes #tag`
  - `not done`

**설정:**
```typescript
tasksQueries: TasksQuery[]  // { name: string, query: string }
```

### 영향 범위

- `types.ts` — `TasksQuery` 인터페이스
- 새 파일: `tasks-query.ts` — 쿼리 파싱 및 실행 엔진
- `panel-data.ts` — 쿼리 결과 수집
- `planning-panel.ts` — 쿼리 섹션 UI
- `settings.ts` — 쿼리 설정 UI

---

## Feature 9: 생성일 자동 추가 (우선순위: 낮음)

### 문제

WeekFlow에서 새 블록을 생성할 때 Tasks 플러그인의 `➕ YYYY-MM-DD` (created date)가 추가되지 않는다.

### 기획

**동작:**
- 새 블록 생성 시 `➕ YYYY-MM-DD` 자동 추가 (생성 시점의 날짜)
- 기존 블록에는 영향 없음

**설정:**
```typescript
tasksAutoCreatedDate: boolean  // default: false (opt-in)
```

### 영향 범위

- `block-actions.ts` — createBlock 시 `➕` 추가
- `parser.ts` — rawSuffix 조작

---

## 구현 로드맵

### Phase 7A: Tasks 기본 통합 (Feature 1, 3, 4, 9)

**목표:** rawSuffix를 구조화하고, 가장 빈번한 사용 시나리오를 지원

**작업 순서:**
1. `types.ts`에 구조화 필드 추가 (`priority`, `dueDate`, `scheduledDate`, `doneDate`, `recurrence`, `taskId`, `dependsOn`)
2. `parser.ts`에 메타데이터 파싱/조작 유틸리티 추가
3. 완료 시 `✅` 자동 관리 (Feature 1)
4. 우선순위 시각 표시 (Feature 3)
5. 마감일 배지 및 경고 (Feature 4)
6. 생성일 자동 추가 (Feature 9)
7. 설정 UI 추가

**예상 변경 파일:** `types.ts`, `parser.ts`, `block-actions.ts`, `grid-renderer.ts`, `planning-panel.ts`, `settings.ts`, `styles.css`

### Phase 7B: Tasks 워크플로우 통합 (Feature 2, 5, 6)

**목표:** 반복/이동/완료 등 핵심 워크플로우에서 Tasks 메타데이터를 능동적으로 관리

**작업 순서:**
1. 반복 규칙 파서 구현 (Feature 2)
2. 반복 태스크 완료 → 다음 인스턴스 생성
3. 블록 이동 시 scheduled date 동기화 (Feature 5)
4. 프로젝트 태스크 완료 동기화 (Feature 6)
5. 확인 모달 UI 구현

**예상 신규 파일:** `recurrence.ts` (반복 규칙 엔진), `recurrence-modal.ts`, `sync-modal.ts`

### Phase 7C: Tasks 고급 통합 (Feature 7, 8)

**목표:** 파워 유저를 위한 고급 기능

**작업 순서:**
1. 의존성 파싱 및 시각화 (Feature 7)
2. Tasks 쿼리 엔진 구현 (Feature 8)
3. Planning Panel 쿼리 섹션 UI

**예상 신규 파일:** `tasks-query.ts`

---

## 설정 요약

Phase 7A~7C에서 추가되는 모든 설정값:

```typescript
// WeekFlowSettings 확장
{
  // Phase 7A
  tasksAutoCompletionDate: boolean;     // default: true
  tasksDueDateWarning: boolean;         // default: true
  tasksDueDateWarningDays: number;      // default: 1
  tasksAutoCreatedDate: boolean;        // default: false

  // Phase 7B
  tasksRecurrenceEnabled: boolean;      // default: true
  tasksRecurrenceConfirmation: boolean; // default: true
  tasksSyncScheduledDate: boolean;      // default: true
  tasksProjectSyncCompletion: "ask" | "always" | "never";  // default: "ask"

  // Phase 7C
  tasksQueries: { name: string; query: string }[];  // default: []
}
```

---

## 데이터 호환성 보장 원칙

1. **rawSuffix 무결성:** 구조화 파싱은 읽기 전용 목적. 쓰기 시에는 항상 rawSuffix를 기반으로 특정 이모지만 수정/추가/제거한다.
2. **이모지 순서 보존:** 사용자가 작성한 메타데이터의 순서를 변경하지 않는다. 새로 추가되는 메타데이터는 rawSuffix 끝에 append.
3. **Tasks 플러그인 미설치 환경:** 모든 Tasks 통합 기능은 opt-in이며, Tasks 플러그인이 없어도 WeekFlow는 정상 동작한다.
4. **Custom Status 호환:** Tasks 플러그인의 커스텀 체크박스 상태(`- [/]`, `- [-]` 등)는 현재 WeekFlow가 `[ ]`, `[x]`, `[>]`만 인식하므로, 추가 상태 지원은 별도 기획이 필요하다.

---

## 리스크 및 고려사항

| 리스크 | 대응 |
|--------|------|
| Tasks 플러그인 API 변경 | 이모지 기반 파싱이므로 API 의존성 없음. 이모지 형식 변경 시만 영향 |
| 반복 규칙의 복잡성 | Phase 7B 초기에는 기본 규칙만 지원, 점진적 확장 |
| 프로젝트 동기화 충돌 | 단방향 동기화만 제공, 양방향은 복잡성 대비 가치 낮음 |
| rawSuffix 조작 시 데이터 손상 | 정규식 기반 정밀 치환, 단위 테스트 필수 |
| Tasks 커스텀 상태 (`- [/]` 등) | WeekFlow 체크박스 인식 확장은 별도 기획 |
