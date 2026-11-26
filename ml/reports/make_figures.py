"""모델 개발 리포트용 그림을 만든다 (REPORT.md 가 이 그림들을 쓴다).

실행: python reports/make_figures.py   (ml/ 에서)
- 최종 검증 기간(11/20–23) 값은 data/metrics.csv, data/predictions/*.parquet, models/ 에서 직접 읽는다.
- 이전 실험(1·2차 비교, 데이터 양, 4/5단계, 앙상블, 보정, 대기 모델)은 당시 DECISIONS.md 에 적어 둔 표의 숫자다.
  그 실험의 원본 산출물은 덮어써져서 다시 읽을 수 없다.
"""
from pathlib import Path

import lightgbm as lgb
import matplotlib as mpl
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
OUT = Path(__file__).resolve().parent / "fig"
OUT.mkdir(exist_ok=True)

mpl.rcParams.update({
    "font.family": "AppleGothic", "axes.unicode_minus": False,
    "figure.dpi": 110, "savefig.dpi": 160, "savefig.bbox": "tight",
    "axes.spines.top": False, "axes.spines.right": False,
    "axes.grid": True, "grid.alpha": 0.25, "axes.axisbelow": True,
    "axes.titlesize": 12, "axes.titleweight": "bold", "legend.frameon": False,
})
C = {"lgbm": "#1F5FBF", "rf": "#7FA6DD", "mlp": "#8E6BBF", "delta": "#2FA37A", "logreg": "#B7B7B7",
     "frequency": "#E3A04B", "current_stage": "#D9534F", "ens": "#555555"}
NAME = {"lgbm": "LightGBM", "random_forest": "랜덤 포레스트", "mlp": "MLP", "delta": "좌석 변화량 회귀",
        "logreg": "로지스틱 회귀", "frequency": "과거 빈도", "current_stage": "현재 단계 유지"}
KEY = {"lgbm": "lgbm", "random_forest": "rf", "mlp": "mlp", "delta": "delta", "logreg": "logreg",
       "frequency": "frequency", "current_stage": "current_stage"}
STAGES = ["0석", "1–4석", "5–9석", "10–19석", "20석+"]


def save(fig, name):
    fig.savefig(OUT / f"{name}.png")
    plt.close(fig)
    print("saved", name)


def val_frame(model="lgbm"):
    d = pd.read_parquet(ROOT / f"data/predictions/{model}.parquet")
    d = d[(d.split == "val") & ~d.ambiguous].copy()
    d["segment"] = d.key_segment.fillna("그 외")
    return d


# ---------------------------------------------------------------- 1. 문제: 라벨 분포
def fig_problem():
    d = val_frame()
    fig, ax = plt.subplots(1, 2, figsize=(11, 3.8), gridspec_kw={"width_ratios": [1.1, 1]})
    groups = [("전체", d), ("출근", d[d.segment == "출근"]), ("퇴근", d[d.segment == "퇴근"])]
    colors = ["#D93025", "#F0A04B", "#F3C98B", "#7FA6DD", "#1F5FBF"]
    left = np.zeros(len(groups))
    for s in range(5):
        share = np.array([(g.stage == s).mean() * 100 for _, g in groups])
        ax[0].barh([n for n, _ in groups], share, left=left, color=colors[s], label=STAGES[s])
        for i, v in enumerate(share):
            if v > 4:
                ax[0].text(left[i] + v / 2, i, f"{v:.0f}%", ha="center", va="center", color="white", fontsize=9, fontweight="bold")
        left += share
    ax[0].invert_yaxis()
    ax[0].set_xlim(0, 100)
    ax[0].set_xlabel("도착 샘플 비율 (%)")
    ax[0].set_title("도착 잔여석 분포 (검증 기간)")
    ax[0].legend(ncol=5, loc="upper center", bbox_to_anchor=(0.5, -0.2), fontsize=8.5)
    ax[0].grid(False)

    hour = d.observed_at.dt.hour
    for seg, col in [("출근", "#D93025"), ("퇴근", "#1F5FBF")]:
        g = d[d.segment == seg]
        h = g.groupby(hour[g.index]).stage.apply(lambda s: (s == 0).mean() * 100)
        ax[1].plot(h.index, h.values, "o-", color=col, label=seg, markersize=4)
    allh = d.groupby(hour).stage.apply(lambda s: (s == 0).mean() * 100)
    ax[1].plot(allh.index, allh.values, "--", color="#999", label="전체")
    ax[1].set_xlabel("시각")
    ax[1].set_ylabel("만석(0석) 도착 비율 (%)")
    ax[1].set_title("시간대별 만석 비율")
    ax[1].legend()
    save(fig, "01_problem")


# ---------------------------------------------------------------- 2. 최종 모델 비교
def fig_final_comparison():
    m = pd.read_csv(ROOT / "data/metrics.csv")
    panels = [("출근", "rps", "출근 RPS (낮을수록 좋음)"), ("퇴근", "rps", "퇴근 RPS"),
              ("실제 만석", "brier_1", "실제 만석에서 P(≥1) Brier")]
    fig, axes = plt.subplots(1, 3, figsize=(13, 4))
    for ax, (grp, col, title) in zip(axes, panels):
        t = m[m.group == grp].set_index("model")[col].sort_values()
        ax.barh([NAME[i] for i in t.index], t.values, color=[C[KEY[i]] for i in t.index])
        for y, v in enumerate(t.values):
            ax.text(v, y, f" {v:.3f}", va="center", fontsize=9)
        ax.invert_yaxis()
        ax.set_title(title)
        ax.set_xlim(0, t.max() * 1.32)
        ax.grid(axis="y", alpha=0)
    fig.suptitle("최종 검증 기간(11/20–23) 모델 비교 — LightGBM이 출근·만석에서 1위", fontsize=13, fontweight="bold", y=1.03)
    save(fig, "02_final_comparison")

    # F1: 단계를 정확히 맞힌 정도
    fig, ax = plt.subplots(figsize=(9, 3.8))
    order = ["lgbm", "delta", "mlp", "random_forest", "logreg", "frequency", "current_stage"]
    x = np.arange(len(order))
    for k, (grp, col) in enumerate([("출근", "#D93025"), ("퇴근", "#1F5FBF")]):
        vals = [m[(m.model == o) & (m.group == grp)].macro_f1.iloc[0] for o in order]
        ax.bar(x + (k - 0.5) * 0.38, vals, 0.38, color=col, label=grp, alpha=0.9)
    ax.set_xticks(x, [NAME[o] for o in order], rotation=15)
    ax.set_ylabel("macro-F1 (높을수록 좋음)")
    ax.set_title("5단계를 맞힌 정도 (macro-F1)")
    ax.legend()
    save(fig, "03_f1")


# ---------------------------------------------------------------- 3. 실험 회차별 변화
def fig_rounds():
    rounds = ["1차\n(11/09 평가)", "2차\n(11/10–11)", "최종\n(11/20–23)"]
    rps = {"lgbm": [0.095, 0.099, 0.087], "random_forest": [0.111, 0.112, 0.110],
           "logreg": [0.166, 0.161, 0.144], "frequency": [0.194, 0.194, 0.159],
           "current_stage": [0.237, 0.267, 0.255], "delta": [None, 0.121, 0.100], "mlp": [None, 0.137, 0.095]}
    fig, ax = plt.subplots(1, 2, figsize=(12, 4))
    for k, v in rps.items():
        xs = [i for i, a in enumerate(v) if a is not None]
        ax[0].plot(xs, [v[i] for i in xs], "o-", color=C[KEY[k]], label=NAME[k], linewidth=2.4 if k == "lgbm" else 1.4)
    ax[0].set_xticks(range(3), rounds)
    ax[0].set_ylabel("출근 RPS (낮을수록 좋음)")
    ax[0].set_title("회차별 출근 RPS — MLP는 데이터가 늘며 따라옴")
    ax[0].legend(fontsize=8, ncol=2)

    # 학습 비율 (1차 시험, 시드 5회 평균)
    frac = [10, 25, 50, 100]
    ax[1].plot(frac, [0.218, 0.157, 0.131, 0.120], "o-", color=C["lgbm"], linewidth=2.2, label="RPS")
    ax[1].set_xlabel("사용한 학습 운행 비율 (%)")
    ax[1].set_ylabel("출근 RPS", color=C["lgbm"])
    a2 = ax[1].twinx()
    a2.plot(frac, [0.347, 0.412, 0.481, 0.516], "s--", color=C["frequency"], label="macro-F1")
    a2.set_ylabel("출근 macro-F1", color=C["frequency"])
    a2.grid(False)
    a2.spines["right"].set_visible(True)
    ax[1].set_title("학습 데이터를 줄이면 (LightGBM, 포화 전)")
    save(fig, "04_rounds")


# ---------------------------------------------------------------- 4. 데이터 양
def fig_data_volume():
    days = [5, 9, 12, 15]
    fig, ax = plt.subplots(figsize=(7.5, 4))
    ax.plot(days, [0.099, 0.091, 0.088, 0.087], "o-", color="#D93025", label="출근 RPS", linewidth=2)
    ax.plot(days, [0.096, 0.088, 0.086, 0.084], "s--", color="#D93025", alpha=0.6, label="출근 P(≥1) Brier")
    ax.plot(days, [0.058, 0.054, 0.054, 0.053], "o-", color="#1F5FBF", label="퇴근 RPS", linewidth=2)
    ax.set_xticks(days, ["5일\n(~11/09)", "9일\n(~11/13)", "12일\n(~11/16)", "15일\n(~11/19)"])
    ax.set_xlabel("학습에 쓴 날 수")
    ax.set_ylabel("검증 기간(11/20–23) 오차 (낮을수록 좋음)")
    ax.set_title("LightGBM: 9일까지 뚜렷이 좋아지고 이후 거의 멈춤")
    ax.legend()
    save(fig, "05_data_volume")


# ---------------------------------------------------------------- 5. 4단계 vs 5단계
def fig_stage_split():
    labels = ["RPS\n(4단계 기준)", "P(≥1)\nBrier", "P(≥10)\nBrier"]
    a4 = {"출근": [0.099, 0.109, 0.088], "퇴근": [0.068, 0.059, 0.075]}
    a5 = {"출근": [0.102, 0.111, 0.093], "퇴근": [0.069, 0.061, 0.075]}
    fig, ax = plt.subplots(1, 3, figsize=(13, 3.8), gridspec_kw={"width_ratios": [1, 1, 1.1]})
    for i, seg in enumerate(["출근", "퇴근"]):
        x = np.arange(3)
        ax[i].bar(x - 0.2, a4[seg], 0.4, color="#B7B7B7", label="4단계 (0/1–4/5–9/10+)")
        ax[i].bar(x + 0.2, a5[seg], 0.4, color=C["lgbm"], label="5단계 (10–19 / 20+ 분리)")
        ax[i].set_xticks(x, labels)
        ax[i].set_title(f"{seg}: 기존 지표 손실 0.002–0.005")
        ax[i].set_ylim(0, max(a4[seg] + a5[seg]) * 1.25)
    ax[0].legend(fontsize=8, loc="upper right")
    f1 = {"출근": [0.570, 0.801], "퇴근": [0.330, 0.920]}
    x = np.arange(2)
    for k, (seg, col) in enumerate([("출근", "#D93025"), ("퇴근", "#1F5FBF")]):
        ax[2].bar(x + (k - 0.5) * 0.38, f1[seg], 0.38, color=col, label=seg)
    ax[2].set_xticks(x, ["10–19석 F1", "20석 이상 F1"])
    ax[2].set_title("새로 얻은 구분 (5단계)")
    ax[2].legend()
    fig.suptitle("결정: 10석 이상을 둘로 나눔 — 점수 손실은 오차 안, 대신 '넉넉함(20+)'을 알 수 있다", fontweight="bold", y=1.05)
    save(fig, "06_stage_split")


# ---------------------------------------------------------------- 6. 거리별 중간단계 F1
def fig_distance():
    rows = ["출근 1–3개 앞", "출근 4–10개 앞", "퇴근 1–3개 앞", "퇴근 4–10개 앞"]
    z = np.array([[0.82, 0.51, 0.56, 0.71, 0.87], [0.72, 0.01, 0.17, 0.30, 0.59],
                  [0.77, 0.40, 0.43, 0.60, 0.96], [0.63, 0.11, 0.02, 0.25, 0.90]])
    fig, ax = plt.subplots(figsize=(7.5, 3.6))
    im = ax.imshow(z, cmap="Blues", vmin=0, vmax=1, aspect="auto")
    ax.set_xticks(range(5), STAGES)
    ax.set_yticks(range(4), rows)
    for i in range(4):
        for j in range(5):
            ax.text(j, i, f"{z[i, j]:.2f}", ha="center", va="center", color="white" if z[i, j] > 0.55 else "#222", fontsize=10)
    ax.grid(False)
    ax.set_title("단계별 F1: 곧 도착할 버스는 맞히고, 4정거장 이상 앞은 어렵다")
    fig.colorbar(im, ax=ax, fraction=0.03)
    save(fig, "07_distance_f1")


# ---------------------------------------------------------------- 7. 확률 보정 + 혼동행렬 (실제 예측)
def fig_reliability():
    d = val_frame()
    fig, ax = plt.subplots(1, 3, figsize=(15, 4.2), gridspec_kw={"wspace": 0.4})
    bins = np.linspace(0, 1, 11)
    for seg, col in [("출근", "#D93025"), ("퇴근", "#1F5FBF")]:
        g = d[d.segment == seg]
        p = 1 - g.p0.to_numpy()
        y = (g.stage >= 1).to_numpy()
        idx = np.clip(np.digitize(p, bins) - 1, 0, 9)
        xs, ys, ns = [], [], []
        for b in range(10):
            sel = idx == b
            if sel.sum() >= 20:
                xs.append(p[sel].mean()); ys.append(y[sel].mean()); ns.append(sel.sum())
        ax[0].plot(xs, ys, "o-", color=col, label=f"{seg} (n={len(g):,})")
    ax[0].plot([0, 1], [0, 1], ":", color="#888")
    ax[0].set_xlabel("모델이 말한 P(1석 이상)")
    ax[0].set_ylabel("실제 1석 이상 비율")
    ax[0].set_title("확률 신뢰도 (검증 기간)")
    ax[0].legend()

    cm = np.zeros((5, 5))
    probs = d[["p0", "p1", "p2", "p3", "p4"]].to_numpy()
    pred = probs.argmax(1)
    for t, p_ in zip(d.stage.to_numpy(), pred):
        cm[int(t), p_] += 1
    cmn = cm / cm.sum(1, keepdims=True)
    im = ax[1].imshow(cmn, cmap="Blues", vmin=0, vmax=1)
    for i in range(5):
        for j in range(5):
            ax[1].text(j, i, f"{cmn[i, j]*100:.0f}", ha="center", va="center", color="white" if cmn[i, j] > 0.5 else "#222", fontsize=9)
    ax[1].set_xticks(range(5), STAGES, rotation=30)
    ax[1].set_yticks(range(5), STAGES)
    ax[1].set_xlabel("예측 (가장 높은 단계)")
    ax[1].set_ylabel("실제")
    ax[1].set_title("혼동행렬 (행 기준 %) — 틀려도 이웃 단계")
    ax[1].grid(False)

    # 몇 정거장 앞인지에 따른 RPS
    from_cum = lambda a: np.cumsum(a, axis=1)[:, :-1]
    def rps(frame):
        pr = from_cum(frame[["p0", "p1", "p2", "p3", "p4"]].to_numpy())
        tr = np.cumsum(np.eye(5)[frame.stage.to_numpy().astype(int)], axis=1)[:, :-1]
        return ((pr - tr) ** 2).sum(1) / 4
    d["rps"] = rps(d)
    ahead = pd.cut(d.stops_ahead, [0, 3, 6, 10, 15, 25], labels=["1–3", "4–6", "7–10", "11–15", "16+"])
    for seg, col in [("출근", "#D93025"), ("퇴근", "#1F5FBF"), ("그 외", "#999")]:
        s = d[d.segment == seg].groupby(ahead[d.segment == seg], observed=True).rps.mean()
        ax[2].plot(s.index.astype(str), s.values, "o-", color=col, label=seg)
    ax[2].set_xlabel("몇 정거장 앞에 있는 버스인가")
    ax[2].set_ylabel("RPS")
    ax[2].set_title("멀수록 어려워진다")
    ax[2].legend()
    save(fig, "08_reliability")


# ---------------------------------------------------------------- 8. 앙상블
def fig_ensemble():
    labels = ["출근\nRPS", "출근\nP(≥1)", "퇴근\nRPS", "퇴근\nP(≥1)", "실제 만석\nP(≥1)"]
    lg = [0.092, 0.111, 0.069, 0.061, 0.325]
    en = [0.090, 0.114, 0.070, 0.063, 0.397]
    fig, ax = plt.subplots(figsize=(8.5, 4))
    x = np.arange(5)
    ax.bar(x - 0.2, lg, 0.4, color=C["lgbm"], label="LightGBM 단독")
    ax.bar(x + 0.2, en, 0.4, color=C["ens"], label="LightGBM + 좌석 변화량 회귀")
    for i, (a, b) in enumerate(zip(lg, en)):
        ax.text(i + 0.2, b, "▲나쁨" if b > a else "▼좋음", ha="center", va="bottom", fontsize=8, color="#D9534F" if b > a else "#2FA37A")
    ax.set_xticks(x, labels)
    ax.set_ylabel("낮을수록 좋음")
    ax.set_title("앙상블 시험: 출근 RPS는 나아지지만 만석에서 크게 나빠져 채택 안 함")
    ax.legend()
    save(fig, "09_ensemble")


# ---------------------------------------------------------------- 9. 확률 보정 시험
def fig_calibration():
    fig, ax = plt.subplots(1, 2, figsize=(12, 4))
    days = ["11/09\n(보정일)", "11/10", "11/11"]
    pred = [0.74, 0.75, 0.74]
    actual = [0.75, 0.51, 0.64]
    full = [7.2, 12.2, 10.2]
    x = np.arange(3)
    ax[0].bar(x - 0.2, pred, 0.4, color="#B7B7B7", label="모델 예측 평균 (0.5–0.9 구간)")
    ax[0].bar(x + 0.2, actual, 0.4, color=C["lgbm"], label="실제 비율")
    for i, f in enumerate(full):
        ax[0].text(i, 0.04, f"만석 {f}%", ha="center", color="white", fontsize=9, fontweight="bold")
    ax[0].set_xticks(x, days)
    ax[0].set_ylim(0, 1)
    ax[0].set_title("퇴근: 같은 모델이 날마다 다르게 틀린다")
    ax[0].legend(fontsize=8, loc="upper right")

    labels = ["보정 전", "온도 조정", "isotonic"]
    ll = [0.615, 0.582, 1.005]
    ax[1].bar(labels, ll, color=["#B7B7B7", C["delta"], "#D9534F"])
    for i, v in enumerate(ll):
        ax[1].text(i, v, f"{v:.3f}", ha="center", va="bottom")
    ax[1].set_ylabel("퇴근 로그손실 (11/10–11)")
    ax[1].set_title("보정 시도: 고정 규칙으로 얻는 것이 거의 없다")
    save(fig, "10_calibration")


# ---------------------------------------------------------------- 10. 대기 인원 모델
def fig_waiting():
    fig, ax = plt.subplots(1, 3, figsize=(14.5, 4))
    pred = [0.2, 0.4, 0.6, 0.8]
    ax[0].plot([0, 1], [0, 1], ":", color="#888", label="이상적")
    ax[0].plot(pred, [0.24, 0.46, 0.57, 0.87], "o-", color=C["lgbm"], label="대기 모델")
    ax[0].plot(pred, [0.35, 0.62, 0.86, 0.98], "s-", color=C["frequency"], label="과거 평균")
    ax[0].set_xlabel("예측한 만석 출발 확률 (구간 중앙)")
    ax[0].set_ylabel("실제 만석 출발 비율")
    ax[0].set_title("1차: 애매한 구간에서 대기 모델이 정직")
    ax[0].legend()

    names = ["곱\n(1차)", "덧셈\n제약 없음", "덧셈+제약\n(2차)", "과거 평균"]
    mx = [133, 76, 43, 17]
    ax[1].bar(names, mx, color=["#D9534F", "#E3A04B", C["lgbm"], "#B7B7B7"])
    ax[1].axhline(45, color="#333", linestyle="--")
    ax[1].text(-0.4, 50, "버스 정원 45석 안팎", ha="left", fontsize=8)
    for i, v in enumerate(mx):
        ax[1].text(i, v, f"{v}명", ha="center", va="bottom")
    ax[1].set_ylabel("앞차 만석일 때 '내 앞 인원' 예측 최대")
    ax[1].set_title("2차: 비현실적인 83·133명을 잡음")

    stages = ["곱\n(1차)", "덧셈+몰림\n(3차 채택)"]
    ax[2].bar(["로그우도\n(높을수록 좋음)"], [0], alpha=0)
    ax[2].cla()
    labels = ["과거 평균", "곱 (1차)", "덧셈+몰림"]
    ll = [-1.861, -1.827, -1.800]
    mae = [2.19, 2.12, 1.98]
    ax[2].bar(labels, mae, color=["#B7B7B7", "#E3A04B", C["lgbm"]])
    for i, v in enumerate(mae):
        ax[2].text(i, v, f"{v:.2f}명\n(LL {ll[i]:.2f})", ha="center", va="bottom", fontsize=9)
    ax[2].set_ylim(0, 2.8)
    ax[2].set_ylabel("MAE (만석 출발 제외, 낮을수록 좋음)")
    ax[2].set_title("3차: 최종 검증 기간 묶음 5,552개")
    save(fig, "11_waiting")


# ---------------------------------------------------------------- 11. LightGBM 내부
def fig_lgbm():
    cur = pd.read_csv(ROOT / "models/lgbm_curve.csv")
    b = lgb.Booster(model_file=str(ROOT / "models/lgbm.txt"))
    imp = pd.Series(b.feature_importance("gain"), index=b.feature_name())
    imp = (imp / imp.sum() * 100).sort_values().tail(12)
    label = {"target_station_id": "정류장 (ID)", "lead_seats": "앞차 잔여석", "current_seq": "버스 현재 위치",
             "current_seats": "버스 현재 잔여석", "between_boardings": "사이 정류장 승차(2025)",
             "lead_age_minutes": "앞차 이후 경과(분)", "hour": "시각", "between_alightings": "사이 정류장 하차(2025)",
             "half_hour": "30분 단위 시각", "target_alightings": "내 정류장 하차(2025)",
             "stops_ahead": "몇 정거장 앞", "front_seq_gap": "앞차와 거리", "target_boardings": "내 정류장 승차(2025)",
             "front_seats": "앞 버스 잔여석", "target_seq": "정류장 순번"}
    fig, ax = plt.subplots(1, 2, figsize=(13, 4.4))
    ax[0].plot(cur.index, cur.multi_logloss_train, color="#B7B7B7", label="학습")
    ax[0].plot(cur.index, cur.multi_logloss_valid, color=C["lgbm"], label="검증")
    best = cur.multi_logloss_valid.idxmin()
    ax[0].axvline(best, color="#D9534F", linestyle="--")
    ax[0].text(best - 5, 0.55, f"검증 최적 {best}회", color="#D9534F", ha="right")
    ax[0].set_xlabel("부스팅 횟수")
    ax[0].set_ylabel("다중 로그손실")
    ax[0].set_title("LightGBM 학습 곡선")
    ax[0].legend(loc="center right")
    ax[1].barh([label.get(i, i) for i in imp.index], imp.values, color=C["lgbm"])
    ax[1].set_xlabel("중요도 (gain, %)")
    ax[1].set_title("무엇을 보고 예측하나 (상위 12)")
    ax[1].grid(axis="y", alpha=0)
    save(fig, "12_lgbm_inside")


# ---------------------------------------------------------------- 12. 개발 타임라인
def fig_timeline():
    ev = [("11/05", "수집 시작"), ("11/06", "라벨·특징 검증\n누수 시험"), ("11/09", "모델 1차 비교\nLightGBM 1위"),
          ("11/12", "5단계 · 앙상블 시험\n대기 모델 1–3차"), ("11/20–23", "최종 검증\n앱 데모"), ("11/25", "배포·앱 4차"),
          ("11/28", "테스트 평가\n(1회, 예정)")]
    fig, ax = plt.subplots(figsize=(13, 2.6))
    ax.axhline(0, color="#999", zorder=0)
    for i, (d, t) in enumerate(ev):
        ax.plot(i, 0, "o", color=C["lgbm"] if i < len(ev) - 1 else "#B7B7B7", markersize=11)
        ax.text(i, 0.18, d, ha="center", fontweight="bold")
        ax.text(i, -0.2, t, ha="center", va="top", fontsize=9)
    ax.set_xlim(-0.5, len(ev) - 0.5)
    ax.set_ylim(-1, 0.6)
    ax.axis("off")
    save(fig, "00_timeline")


if __name__ == "__main__":
    fig_timeline()
    fig_problem()
    fig_final_comparison()
    fig_rounds()
    fig_data_volume()
    fig_stage_split()
    fig_distance()
    fig_reliability()
    fig_ensemble()
    fig_calibration()
    fig_waiting()
    fig_lgbm()
