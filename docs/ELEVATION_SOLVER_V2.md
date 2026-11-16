> 구현 위치: 이 설계는 `tools/elevation/`에 있다. `solver_config.py`는 권장 파라미터 표의 모든 값(튜닝 파라미터 전부), `node_wls.py`는 "1단계: 노드 WLS"(평지 클러스터 병합·클러스터 prior, 계단 단높이 변수와 방향 2-pass, 경사로 g_max active-set, Huber IRLS, 건물 H_1F 하한과 "실측 높이차가 들어왔을 때"의 4분면 규칙, 이상 간선 로그), `grid_grading.py`는 "2단계: 폭 2 m 회랑 래스터화", "건물 1층 대지", "건물 1층 고도 조정: 묻힌 면적 비증가"의 묻힘 면적과 기준고, "건물 사면 목표면", "아일랜드 탐지와 Laplace 메우기", "어깨 screened Poisson"을, `campo_height_solver.py`는 처리 순서 전체를 잇는 CLI(`--engine v2`, 기본은 v1)를 구현한다. 검증 체크리스트는 `test_grid_grading.py`, `test_node_wls.py`, `test_solver_v2_cli.py`, `test_grid_perf.py`가 맡는다. 아래는 설계 명세 원문이며 고치지 않았다.

# 캠포 높이 솔버 v2 설계안

## 개요
기존 2단계(노드 잔차 + Wendland C² 보간)를 격자 위 제약 PDE 풀이로 바꾼다.
- 길 셀과 건물 1층 대지 셀은 높이를 고정(Dirichlet).
- 아일랜드는 높이 h에 대한 Laplace 방정식으로 메운다.
- 어깨와 건물 사면은 변위 d = h − DEM에 대한 screened Poisson 방정식으로 푼다.
- 프로토타입(scipy만, 1500×1500 합성 DEM, 노드 484, 선분 1,142, 2코어)에서 격자 단계 1.72초: 회랑 래스터화 0.07 s, 아일랜드 0.04 s, 어깨 행렬 조립 0.51 s, 어깨 CG 1.09 s(미지수 1,338,591). 길 셀 오차 0, 아일랜드 최고점이 주변 길 최고점을 넘지 않음을 확인. 건물 규칙은 아직 프로토타입의 격자 단계에 없고, 건물 실측 보정의 비대칭 가중 규칙만 노드 2개짜리 장난감 WLS로 확인했다.

## 처리 순서
1. 노드 WLS(개정): 평지 클러스터 병합, 계단·경사로가 평지 높이를 이어받음, 건물 H_1F 하한 제약과 실측 높이차 반영.
2. 래스터화: 폭 2 m 회랑과 건물 1층 폴리곤을 목표고로 고정.
3. 건물 사면 목표면: 묻히는 쪽 깎기 사면(앞마당 포함), 뜨는 쪽 쌓기 사면.
4. 아일랜드 탐지와 Laplace 메우기.
5. 어깨 블렌딩: 고정 영역 바깥 띠(≤15 m)에서 d를 screened Poisson으로 풀어 원래 지형에 접합.

## 1단계: 노드 WLS
가중치 서열: 평지 클러스터는 넓은 면적 DEM을 모아 강한 기준(σ≈0.6 m), 계단·경사로 중간 노드는 약한 DEM prior(σ=3~5 m).

평지 클러스터: flat_exact 간선으로 연결된 노드를 union-find로 묶어 변수 하나 H_c로 둔다(큰 가중치 대신 변수 병합 → 조건수 유지, Δh=0 정확). 평지 길이 삼각형이면 자동으로 한 클러스터.
클러스터 prior: z̄_c = median{DEM(p) : p ∈ Ω_c}(Ω_c = 클러스터 간선의 폭 2 m 회랑 셀), σ_c² = σ_dem² / min(N_c/ℓ_corr, N_max), ℓ_corr≈10 셀, N_max=25 → σ_c 최솟값 0.6 m.

에너지:
E(H, r) = Σ_c (H_c − z̄_c)²/σ_c²
 + Σ_{stair} [(H_j − H_i − s_e·n_e·r_e)²/σ_st² + (r_e − r_0)²/σ_r²]
 + Σ_{ramp} (H_j − H_i − Δ_dem)²/σ_rp²
 + Σ_{soft} (H_j − H_i)²/σ_sf²
 + E_breakline + E_building
- 계단: 단높이 r_e를 계단마다 변수로 두고 prior N(r_0=0.16, σ_r=0.015). 방향 s_e(±1)는 속성이 있으면 사용, 없으면 계단 항을 빼고 한 번 풀어 Δh 부호로 방향을 정해 다시 푼다(2-pass).
- 경사로: DEM 높이차를 약하게 따르되 |Δh| ≤ g_max·L. active-set: 위반 간선에 (Δh − sign·g_max·L)²/0.01² 항을 추가하고 재풀이, 2~3회 수렴.
- soft_flat, breakline_drop: v1 그대로.
- 강건화: DEM prior 항에 Huber IRLS(δ=1.5σ) 2~3회.
- 풀이 후 |잔차|/σ > 3인 간선은 데이터 오류 후보로 로그.
- 건물 하한이 박스 제약이므로 scipy.optimize.lsq_linear(A, b, bounds=(lb, ub))로 푼다(변수 수천 개, 수십 ms).

가중치 표: flat_exact=변수 병합 / 건물 출입구↔H_1F=변수 병합 / 계단 Δh σ=0.05 m + 0.01·n / 단높이 σ_r=0.015 m(r_0=0.16) / 실측 Δh(건물↔지점) σ_meas=0.02 m / soft_flat σ=0.15 m / 경사로 Δh σ=1.0 m + g_max 상한 / 클러스터 prior σ=0.6~3 m(면적 비례) / 건물 H_1F prior: 하한 H_1F ≥ H_1F⁰ + σ_B(아래 규칙에서 정함) / 단독 노드 prior σ=3 m(계단 중간 5 m).

## 2단계: 폭 2 m 회랑 래스터화
선분 e=(i,j)에 대해 셀 중심 p를 투영:
t(p) = clip(((p−P_i)·(P_j−P_i))/‖P_j−P_i‖², 0, 1), d(p) = ‖p − (P_i + t(P_j−P_i))‖, z(p) = (1−t)H_i + tH_j.
d ≤ w/2 (=1 m)인 셀이 길 셀. 목표고는 t에만 의존 → 폭 방향 수평.
- 꺾은선: 선분 단위 처리, t clip으로 끝이 둥근 캡이 되어 꺾임 바깥 틈이 메워짐.
- 교차·겹침: d가 가장 작은 선분의 z. 노드 없이 교차하는 선분(육교·지하차도)은 layer 속성으로 제외.
- 계단 표시(옵션): z = H_i + floor(t·n)/n·(H_j − H_i).
- 1 m 격자 톱니: 1.0 < d ≤ 1.5 셀은 "부분 피복 링". 5단계에서 α(d)=(1.5−d)/0.5 가중치로 목표에 약하게 당김.
- 성능: 선분별 바운딩 박스(반폭+2 m)만 잘라 numpy 벡터화, best_d 배열로 최근접 갱신.

## 건물 1층 대지(Building Pad)
- 1층 폴리곤을 래스터화(numpy/scipy만)해 pad_B로 두고, pad_B 안 모든 셀을 h = H_1F로 고정(DEM 값은 버림; DSM이면 지붕이 섞여 있음).
- 우선순위: 건물 대지 > 길 > 아일랜드 > 사면 목표면 > 어깨 블렌딩. 출입구 노드는 H_1F와 같은 변수라 충돌 없음.

## 건물 1층 고도 조정: 묻힌 면적 비증가
묻힌 면적(건물 외곽 바로 바깥 1셀 링 R_B에서 원본 DEM_0 사용): A_bur(H) = Σ_{q∈R_B} ℓ_q·max(0, DEM_0(q) − H). ℓ_q는 링 셀이 맡는 외곽선 길이(1 m 격자에서 약 1). 기준은 반드시 원본 DEM_0(보정 후 DEM을 쓰면 기준이 변함).
A_bur는 H에 대해 단조 비증가·볼록 → "묻힌 면적이 기준보다 커지면 안 됨" ⇔ 박스 하한 H_1F ≥ H_1F⁰ (기준 상태에서 조금이라도 묻혀 있으면 정확히 동치). 따라서 비선형 면적 제약 없이 lsq_linear의 lb로 처리.
기준 H_1F⁰: 도면·실측 1층 고도가 있으면 그 값 / 없으면 출입구 쪽 링 셀 DEM_0 중앙값 / 출입구 정보도 없으면 링 전체 DEM_0의 30번째 백분위수.

### 실측 높이차가 들어왔을 때 (지점이 건물보다 아래·위 모두)
기호: P = 외부 지점(길 노드 또는 평지 클러스터), D = H_1F − h_P (건물 − 지점), D_meas = 실측값, D₀ = H_1F⁰ − h_P⁰ (기존 DEM 기준값), ε = D_meas − D₀.
ε > 0이면 건물이 지점 대비 올라가야 하고, ε < 0이면 내려가야 한다. 건물은 하한 때문에 내려갈 수 없다.
"지점이 건물보다 아래" = D₀ > 0, "위" = D₀ < 0. D₀ = 0이면 아래인 경우로 취급. ε = 0이면 변화 없음.

WLS에 실측 항 (H_1F − h_P − D_meas)²/σ_meas² (σ_meas = 0.02 m)를 추가하고, 하한 H_1F ≥ H_1F⁰를 lsq_linear의 lb로 건다. 건물 prior는 N(H_1F⁰, σ_B), 지점 prior는 기존 σ_P(클러스터면 면적 비례 σ_c, 단독 노드면 3 m)를 쓴다.
건물 prior의 σ_B는 "ε > 0일 때 건물이 맡는 비율" ρ(building_up_share)로 정한다: σ_B = σ_P · sqrt(ρ / (1 − ρ)). 분배는 prior 분산에 비례하므로(느슨할수록 더 움직임) ρ = σ_B²/(σ_B²+σ_P²).
- 지점이 건물보다 아래(D₀ > 0): ρ = 0.95
- 지점이 건물보다 위(D₀ < 0): ρ = 0.80
부호 판정과 σ 선택은 풀이 전에 DEM 기준값(H_1F⁰, 클러스터 z̄)으로 한 번만 하고, 풀이 도중 바꾸지 않는다.

4분면 결과:
| 지점 위치 | 실측 vs 기존 | 부호 | 결과 |
|---|---|---|---|
| 건물보다 아래 | 실측 차이가 작음 | ε<0 | 건물이 하한에 걸려 그대로, 지점이 올라감 |
| 건물보다 아래 | 실측 차이가 큼 | ε>0 | 건물이 약 95% 올라감, 지점은 약 5% 내려감 |
| 건물보다 위 | 실측 차이가 작음(건물과 지점이 가까워짐) | ε>0 | 건물이 가중을 받아 약 80% 올라감, 지점도 약 20% 내려감 |
| 건물보다 위 | 실측 차이가 큼(멀어짐) | ε<0 | 건물이 하한에 걸려 그대로, 지점이 올라감 |
건물이 올라가면 묻힌 면적은 줄어들거나 그대로이므로 비증가 제약은 모든 경우에 만족된다.
2노드 장난감 WLS(σ_P=0.6, σ_meas=0.02, ε=±1 m)에서 위 표와 같은 분배(건물 +0.00/+0.95/+0.80/+0.00, 지점 +0.999/−0.05/−0.20/+0.999)가 나옴을 확인했다.
지점이 평지 클러스터이거나 계단·경사로가 붙은 경우, 그쪽이 더 뻑뻑하므로 실제 분배는 ρ와 약간 다르다. 클러스터 전체가 함께 이동하고 연결된 계단·경사로도 따라온다. 위에서 지점이 내려가는 경우 클러스터와 연결된 다른 제약(계단 단높이, 경사로 g_max)이 위반되지 않는지 풀이 후 잔차로 확인한다.
하한 갱신 정책: 기본은 원본 기준 H_1F⁰ 고정. 실측이 여러 번 들어올 때 하한을 직전 결과로 올리는 래칫 모드는 선택 옵션(순서 의존 가능).

## 건물 사면 목표면
δ(p) = distance_transform_edt(~pad_B), 앞마당 폭 a.
- 묻히는 쪽(깎기): G_cut = H_1F + s_cut·max(0, δ − a), h* = smin_k(DEM, G_cut), smin_k(x,y) = −k·log(e^{−x/k} + e^{−y/k}). 깎기만 하고 메우지 않음.
- 뜨는 쪽(쌓기): G_fill = H_1F − s_fill·max(0, δ − a), h* = smax_k(DEM, G_fill).
- 앞마당(δ ≤ a)은 H_1F로 고정(단차의 바닥).
- 사면 셀은 Dirichlet이 아니라 어깨 풀이에 강한 소프트 목표 α_B·(d − (h* − DEM))²(α_B=4)로 넣는다. 길(Dirichlet)이 사면을 지나가면 길이 우선.
- 건물과 길 사이가 좁아 사면이 안 들어가면(약 2 m 이하) 수직 단차 허용, 최대 h_step=0.5 m, 넘으면 로그.
- 영향 범위: δ ≤ a + (DEM_max − H_1F)/s_cut까지만 계산.
권장값: a=1.0 m, s_cut=0.67(1:1.5), s_fill=0.5(1:2), k=0.3 m.

## 아일랜드 탐지와 Laplace 메우기
fixed = road ∪ pad ∪ apron(제외 마스크는 별도).
1. ndimage.label(~fixed), 4-연결.
2. 지도 가장자리에 닿는 성분 제외.
3. 남은 성분이 (면적 A ≤ A_max=400 m²) 또는 (성분 내 EDT 최댓값 ≤ R_max=5 m)이면 아일랜드. 제외 마스크가 있으면 성분 외곽 링의 80% 이상이 고정 셀일 때만 인정.
메우기: Δh = 0 in I, h = h_fixed on ∂I. 최대원리로 내부 높이는 경계 높이의 최솟값~최댓값을 벗어나지 않는다. 세 평지 길이 한 클러스터면 내부는 정확히 같은 높이의 평면. 모든 아일랜드를 5점 스텐실 희소행렬 한 번에 조립(블록대각), splu 분해.
디테일 보존(선택): h = H[h_fixed] + κ(DEM − H[DEM|∂I]), κ∈[0, 0.3], 기본 κ=0.
중간 영역(A_max < A ≤ A_big=3000 m²): 변위 d = h − DEM만 조화 보간(delta fill). 어깨 풀이에서 해당 영역 μ=0으로 처리.

## 어깨 screened Poisson (Wendland 대체)
고정 영역 바깥에서는 변위 d = h − DEM을 푼다:
(−Δ + μ + α)·d = α·d̂; d = h_fixed − DEM (길·대지·앞마당·아일랜드), d = 0 (띠 바깥).
- 감쇠 길이 ℓ = 1/√μ(기본 3 m). 1차원 해 d(x) ≈ d_0·e^(−x/ℓ). 띠 폭 BAND = 5ℓ(15 m).
- 사면 경사 제어: 가장 가까운 고정 셀의 |d|를 distance_transform_edt(return_indices=True)로 가져와 ℓ_p = clip(|d_near|/s_side, 2, 8) m, μ_p = 1/ℓ_p². s_side=0.5(1:2). 적응형이면 BAND = 5·ℓ_max.
- 부분 피복 링: 1.0 < d ≤ 1.5 셀은 α_p=(1.5−d)/0.5로 d̂ = z − DEM에 당김.
- 건물 사면 셀: α_B=4로 d̂^B = h* − DEM에 당김.
- 제외 영역(수면 등): d=0 고정.
- 풀이: 대칭양정치(μ>0). Jacobi 전처리 CG(rtol 1e-6, maxiter 500).
- 프로토타입 관찰: 적응형 ℓ 없이 어깨 최대 경사 0.50(원 DEM 최대 0.28). 적응형 ℓ 적용 후 재측정 필요.

## 권장 파라미터 표
HALF_W 1.0 m / SOFT_RING 0.5 m / A_max 400 m² / R_max 5 m / A_big 3000 m² / κ 0 / ℓ 3 m(적응형 2~8 m) / s_side 0.5 / BAND 15 m / 앞마당 a 1.0 m / s_cut 0.67 / s_fill 0.5 / smooth-min k 0.3 m / α_B 4 / h_step 0.5 m / σ_meas 0.02 m / building_up_share(지점이 아래일 때) 0.95 / building_up_share(지점이 위일 때) 0.80 / CG rtol 1e-6, maxiter 500 / 계단 r_0 0.16 m, σ_r 0.015 m / 경사로 g_max 1/12(무장애), 일반 1/8.

## 검증 체크리스트
길 셀 max|h−z|=0 / 평지 클러스터 내부 표준편차 0 / 길 셀 폭 방향 기울기 0 / 아일랜드 max h ≤ 주변 고정 셀 max / 계단 |Δh/n − r_e| ≤ 0.02 m, r_e∈[0.13, 0.19] m / 경사로 |Δh|/L ≤ g_max / 건물 대지·앞마당 내부 h=H_1F / 모든 건물에서 A_bur(H_1F) ≤ A_bur(H_1F⁰) / 실측 |H_1F − h_P − D_meas| ≤ 0.03 m / 4분면 각각에서 건물·지점 이동 방향과 비율이 표와 일치 / 깎기 사면 최대 경사 ≤ s_cut + 0.05, 수직 단차 > h_step 로그 / 어깨 경사 재측정 / WLS 잔차 |r|/σ > 3 간선 목록.

---

> 구현 위치: 아래 절은 위 설계 명세 원문에 덧붙인 것이다(2026-11-16). `campo_height_solver.py`의 `building_portals`(건물별 출입문 모음 `PortalContact`), `building_pads`(기반층·접지면 기준 하한), `terraced_pads`(테라스 후보·지지 판정), `building_extras`(접지면 묻힌 면적·문턱 잔차), `grid_grading.py`의 `Terrace`·`TerraceCandidate`·`plan_terraces`·`assign_terraces`·`rasterize_pads`(셀 배정)·`building_targets`(테라스별 사면)·`terrace_walls`·`wall_segments`(옹벽 불연속선), `node_wls.py`의 `BuildingPad.plinth_m`·`BuildingSolve.h_pad`가 구현하고, 튜닝 값은 `solver_config.py`의 `BuildingConfig`(`terrace_*`, `door_sill_tol_m`)에 있다. 검증은 `test_portal_pads.py`가 맡는다. v1 엔진은 바뀌지 않았다.

## 포탈 기준 다단 대지(terraced pads)

언덕에 걸친 건물은 아래쪽 1층 문과 위쪽 3·4층 문이 함께 지형에 닿는다. 대지를 1층 평면 하나로 깔면 위쪽 지형이 층고 배수만큼 파이고 위층 문 앞에 수직 단차가 생긴다. 그래서 대지를 출입문이 닿는 원본 지형(DEM₀)으로 지지되는 층마다 한 단(terrace)씩 여러 접지면으로 깔고, 단 사이는 층고 배수의 옹벽으로 둔다.

### 접지면과 기반층
- 층고 = `ext.floor_height_m` 또는 3.9 m. 기반층 높이 plinth = max(0, `ext.plinth_floors`) × 층고(숫자가 아니면 0).
- 기준 접지면 plane(padLevel) = H(padLevel) − plinth (기반층은 최하층 바닥 아래 통짜 블록). 위층 문의 접지면 plane(L) = H(L).
- 참조값: 사이드카 `h1fM`이 있으면 H_1F⁰ = h1fM, 접지면 참조 = h1fM − plinth. 없으면 링 DEM₀(출입구 쪽 링 중앙값, 없으면 백분위)를 접지면 참조로 보고 H_1F⁰ = 그 값 + plinth.
- 하한은 접지면에 건다: H(padLevel) − plinth ≥ 접지면 참조(`BuildingPad.lower_bound`). 노드 WLS는 변수 H에 lb = lower_bound + plinth를 넣는다(lsq_linear 그대로). plinth = 0이면 원문의 H_1F ≥ H_1F⁰와 같다. 래칫도 접지면 기준(직전 H − plinth).
- 알려진 한계(기반층): plinth는 대지 하한(`BuildingPad`)에만 들어간다. 대지 레벨 문의 포탈은 여전히 H(padLevel) − h(바깥) = 0(soft_flat)이고 `campus_corridors`도 H(padLevel)에서 시작하므로, plinth > 0인 건물의 접지층 문 앞 보행로가 plinth만큼 높은 램프로 고정된다(문턱 잔차·수직 단차 로그로 드러남). `test_terrace_edges.py::test_plinth_building_pad_level_door_keeps_the_ground_in_front`(xfail). 제안된 수정: 대지 레벨 포탈 행의 Δh를 +plinth로(`Edge.off_from`/`off_to`) 주고 보행로 시작 높이를 H − plinth로.

### 테라스 후보와 지지
- 후보 층 = {padLevel} ∪ {포탈 층} ∪ {ground_levels}(0 제외). 포탈 = `edge_type: "portal"`이고 한쪽 끝이 그 건물 층 노드, 다른 쪽이 실외 노드나 다른 건물 층 노드인 구간. 역할은 `door_role`(구간, 없으면 문 쪽 노드).
- support(padLevel) = 외곽 링 DEM₀ 중앙값(보고용). support(L > padLevel) = 그 층 문들의 바깥 지점 반경 `entrance_ring_radius_m` 안 건물 밖 셀 DEM₀ 중앙값(없으면 바깥 노드 DEM₀)의 중앙값. 한 층의 문이 여럿이어도 테라스는 하나.
- |support(L) − plane(L)| ≤ `terrace_tol_m`(0.6 m)이면 테라스. 아니면 만들지 않고(지금처럼 사면과 수직 단차 로그) 이유를 남긴다(`4F door not supported by the terrain: plane 41.70 m, support 32.00 m`). padLevel 아래 층, 문이 없는 ground_level, 층 평면 높이가 없는 층도 테라스가 아니다. 개수는 base 포함 `terrace_max_levels`(3)까지, 지지 오차가 작은 순.
- **접지면보다 높아야 한다**: 층 번호 순서는 높이 순서를 보장하지 않는다. 건물 `levels`에 없는 층(예: levels `[1,3]`인데 2F에 문)에 문이 있으면 그 층 평면은 층고 prior 사슬 없이 포탈·DEM만으로 풀려 대지 접지면(plane(padLevel))보다 낮게 나올 수 있다. 그런 후보는 `2F plane 31.10 m is at or below the pad ground plane 31.42 m`로 남기고 테라스를 만들지 않는다(역전된 테라스는 대지를 파고 옹벽을 거꾸로 세운다).
- 알려진 한계: support(L)은 문 바깥 지점 반경 `entrance_ring_radius_m`(5 m) 원판에서 대지 밖 셀의 중앙값이라, 경사면에서는 원판이 위쪽 절반에 치우쳐 대략 `경사 × 2.5 m`만큼 높게 읽힌다(0.5 경사에서 1.0~1.3 m). `terrace_tol_m` 0.6 m보다 커지면 경사면의 위층 문이 지지되지 않는 것으로 판정된다(`test_terrace_edges.py::test_upper_door_on_a_linear_slope_is_supported`, xfail). 문 바깥 지점의 DEM₀(`PortalContact.outside_dem_m`)을 1차 지지값으로 쓰는 것이 제안된 수정이다.

### 셀 배정과 옹벽
- 대지 셀마다 DEM₀에 가장 가까운 plane의 테라스. |DEM₀ − plane(base)| ≤ tol/2이거나 DEM₀가 없으면 base. 각 층 문에서 `entrance_ring_radius_m` 안의 대지 셀은 그 층 테라스로 고정(가까운 문 우선). 고정 셀이 없는 `terrace_min_cells`(4) 미만 4-연결 조각은 가장 많이 맞닿은 다른 테라스로 합친다.
- 테라스 경계(서로 다른 테라스에 속한 같은 건물의 4-이웃 셀 쌍: 대지·앞마당·사면 영역)는 셀 경계 선분으로 만들어 `breakline_links`(감쇠 0)로 격자 링크를 끊는다(`terrace_breakline`). 어깨 screened Poisson과 아일랜드 메우기가 경계를 넘지 않는다.
- 경계 단차는 `building B: terrace boundary 3F/1F step 7.80 m = 2.0 x 3.90 m (retaining wall, …)`로 로그하고, `step_max_m` 초과 쌍은 `terrace_wall_pairs`·`max_terrace_wall_m`으로 따로 센다. `vertical_steps_over_limit`은 옹벽을 빼고 지형 단차만 센다. 단차가 (층 수 + 기반층 수) × 층고에서 `terrace_multiple_tol_m`(0.05 m)보다 벗어나면 경고 로그.

### 사면·묻힌 면적
- `building_targets`를 테라스마다 계산한다(앞마당은 그 테라스 plane, 바깥은 smin/smax 사면, 겹치면 가까운 테라스). 아일랜드 fixed = 길 ∪ 모든 테라스 ∪ 앞마당, 어깨·부분 피복 링·기압 지점은 그대로.
- 묻힌 면적은 접지면 기준이다. 링 셀마다 마주 보는(가장 가까운 대지 셀의) 테라스 plane과 비교하고, 기준은 같은 배정에 plane − (H_pad − H_pad⁰)를 쓴다. 위 테라스는 H_pad + k × 층고라 base에서 A_bur(H_pad) ≤ A_bur(H_pad⁰)가 지켜지면 모든 테라스에서 비증가한다. 한 평면일 때의 값은 `buried_single_plane_m2`로 함께 보고한다.

### 보고(campo-solve-report/1에 선택 키만 추가)
- `buildings[bid]`: `plinth_m`, `h_pad_m`, `h_pad_ref_m`, `pad_lower_bound_m`, `lower_bound_basis`("ground_plane"), `buried_single_plane_m2`, `terraces[{level, plane_m, cells, source(portal/ground_level/sidecar), supported, support_m, boundary_step_m, port_count, reason?, buried_m2?, buried_ref_m2?}]`, `portal_contacts[{edge_id, level, role, step_free, outside, door_residual_m}]`.
- `door_residual_m` = 문 바닥 H(L) − 문 바깥 지점 셀의 보정 후 h. `door_sill_tol_m`(0.25 m) 초과면 로그.
- 대지 셀을 하나도 갖지 못한 테라스(대지 셀이 모두 다른 테라스로 배정된 경우, 예: 작은 탑의 위층 문 하나)는 `supported: false`, `cells: 0`, `reason: "1F terrace keeps no pad cell"`로 보고한다 — 그 평면에는 아무것도 그려지지 않는다.
- `grid`: `terraces`(위 테라스 수), `terrace_wall_pairs`, `max_terrace_wall_m`.
- 노드 WLS는 그대로다(포탈은 지금처럼 soft_flat). `building.terrace_enabled = false`면 테라스 이전과 같은 한 평면 대지.
