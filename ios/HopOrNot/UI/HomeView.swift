import SwiftUI

/// 홈(노선 선택): 지금 시간대 인사 → 지금 달리는 버스 요약 → 최근 본 정류장 → 노선 카드(버스별 잔여석 막대) → 작동 방식
struct HomeView: View {
    @Environment(AppModel.self) private var model
    @State private var showSettings = false

    var body: some View {
        ZStack {
            Brand.paper.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    header
                    greeting
                    statusArea
                    if !model.recents.isEmpty { recents }
                    routes
                    HowItWorks()
                    footer
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 36)
            }
            .refreshable { await model.refreshOverview() }
        }
        .toolbar(.hidden, for: .navigationBar)
        .task(id: "\(model.mode.rawValue)-\(model.serverURL)") {
            // 수집 주기에 맞춰 30초마다 (데모는 한 번)
            while !Task.isCancelled {
                await model.refreshOverview()
                if model.mode == .demo { break }
                try? await Task.sleep(for: .seconds(30))
            }
        }
        .sheet(isPresented: $showSettings) { SettingsView() }
    }

    // MARK: 위

    private var header: some View {
        HStack {
            LogoLockup(height: 32)
            Spacer()
            RoundIconButton(label: "설정", action: { showSettings = true }) { SlidersGlyph() }
        }
        .padding(.top, 6)
    }

    private var greeting: some View {
        let hour = Calendar.current.component(.hour, from: .now)
        let lead = hour < 11 ? "출근길," : (hour >= 16 && hour < 22 ? "퇴근길," : "지금,")
        return VStack(alignment: .leading, spacing: 10) {
            Eyebrow(text: Self.dateText.uppercased())
            VStack(alignment: .leading, spacing: 0) {
                Text(lead).foregroundStyle(Brand.red)
                Text("어느 버스 탈까요?").foregroundStyle(Brand.ink)
            }
            .font(Brand.title(34))
            .tracking(-0.6)
            summaryLine
        }
    }

    private static var dateText: String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "ko_KR")
        f.dateFormat = "M월 d일 EEEE · a h:mm"
        return f.string(from: .now)
    }

    /// 지금 달리는 버스 N대 · 만석 M대
    private var summaryLine: some View {
        Group {
            if model.overview.isEmpty {
                if model.overviewStatus.error == nil { SkeletonBlock(width: 190, height: 16) }
            } else {
                let running = model.overview.values.reduce(0) { $0 + $1.running }
                let full = model.overview.values.reduce(0) { $0 + $1.full }
                HStack(spacing: 8) {
                    Circle().fill(Theme.live).frame(width: 8, height: 8)
                    Text("\(model.dataLabel == "실시간" ? "지금" : "그때") 달리는 버스 \(running)대")
                    Text("·").foregroundStyle(Brand.inkFaint)
                    Text("만석 \(full)대").foregroundStyle(full > 0 ? Color(hex: 0xD93025) : Brand.inkSoft)
                }
                .font(Brand.body(14, .semibold))
                .foregroundStyle(Brand.inkSoft)
            }
        }
        .frame(minHeight: 18, alignment: .leading)
    }

    @ViewBuilder
    private var statusArea: some View {
        if let error = model.overviewStatus.error {
            if model.overview.isEmpty {
                ErrorState(error: error) { Task { await model.refreshOverview() } }
            } else {
                StaleBanner(error: error, since: model.overview.values.first?.updatedAt) { Task { await model.refreshOverview() } }
            }
        }
    }

    // MARK: 최근 본 정류장

    private var recents: some View {
        VStack(alignment: .leading, spacing: 10) {
            Eyebrow(text: "최근 본 정류장")
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(model.recents) { recent in
                        Button { model.openRecent(recent) } label: { RecentChip(recent: recent) }
                            .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 16)
            }
            .padding(.horizontal, -16)
        }
    }

    // MARK: 노선

    private var routes: some View {
        VStack(alignment: .leading, spacing: 12) {
            Eyebrow(text: "노선")
            ForEach(Route.allCases) { route in
                NavigationLink(value: Screen.route(route)) {
                    RouteCard(route: route, summary: model.overview[route], loading: model.overview.isEmpty && model.overviewStatus.error == nil)
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var footer: some View {
        VStack(spacing: 6) {
            LiveDot(label: model.dataLabel)
            Text("경희대 국제캠퍼스 광역버스 · 5100 · 1112 · M5107")
                .font(Brand.body(11))
                .foregroundStyle(Brand.inkFaint)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 4)
    }
}

// MARK: 노선 카드

/// 노선 번호(DIN), 종류, 종점, 지금 달리는 버스마다 잔여석 한 칸씩 (색: 0석 빨강 · 1–9석 주황 · 10석 이상 파랑)
struct RouteCard: View {
    let route: Route
    let summary: RouteSummary?
    let loading: Bool

    var body: some View {
        HStack(spacing: 0) {
            Rectangle().fill(Theme.route(route)).frame(width: 7)
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .center, spacing: 12) {
                    Text(route.rawValue)
                        .font(Brand.number(42))
                        .foregroundStyle(Brand.ink)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(route.kind)
                            .font(Brand.body(11, .heavy))
                            .padding(.horizontal, 7).padding(.vertical, 3)
                            .foregroundStyle(.white)
                            .background(Theme.route(route), in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                        Text("\(route.terminals.0) ↔ \(route.terminals.1)")
                            .font(Brand.body(13, .medium))
                            .foregroundStyle(Brand.inkSoft)
                    }
                    Spacer(minLength: 4)
                    if let badge { badge }
                    Image(systemName: "chevron.right")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(Brand.inkFaint)
                }
                if let summary, summary.running > 0 {
                    stats(summary)
                } else if loading {
                    SkeletonBlock(height: 18, radius: 5)
                    SkeletonBlock(width: 180, height: 13)
                } else if summary != nil {
                    Text("지금 달리는 버스가 없어요").font(Brand.body(13)).foregroundStyle(Brand.inkSoft)
                }
            }
            .padding(Brand.pad)
        }
        .background(Brand.card)
        .clipShape(RoundedRectangle(cornerRadius: Brand.radius, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Brand.radius, style: .continuous).stroke(Brand.line, lineWidth: 1))
        .shadow(color: Brand.ink.opacity(0.05), radius: 10, y: 3)
        .accessibilityElement(children: .combine)
    }

    private var badge: AnyView? {
        guard let summary, summary.running >= 3 else { return nil }
        if summary.pressure <= 0.2 { return AnyView(pill("지금 여유", Color(hex: 0x1F5FBF), Color(hex: 0xEAF1FB))) }
        if summary.pressure >= 0.6 { return AnyView(pill("붐벼요", Color(hex: 0xD93025), Color(hex: 0xFCE9E7))) }
        return nil
    }

    private func pill(_ text: String, _ color: Color, _ background: Color) -> some View {
        Text(text)
            .font(Brand.body(12, .heavy))
            .foregroundStyle(color)
            .padding(.horizontal, 9).padding(.vertical, 4)
            .background(background, in: Capsule())
    }

    /// 한 줄 요약: 운행 대수와 자리 상황
    private func stats(_ summary: RouteSummary) -> some View {
        let tight = summary.full + summary.low
        return HStack(spacing: 6) {
            Text("지금 \(summary.running)대 운행").font(Brand.body(13, .bold)).foregroundStyle(Brand.ink)
            Text("·").foregroundStyle(Brand.inkFaint)
            Text(tight == 0 ? "모두 자리 여유" : "자리 적은 버스 \(tight)대")
                .font(Brand.body(13, .medium))
                .foregroundStyle(tight == 0 ? Brand.inkSoft : Color(hex: 0xB4570A))
        }
    }
}

// MARK: 최근 본 정류장 칩

struct RecentChip: View {
    let recent: RecentStop

    var body: some View {
        let route = Route(rawValue: recent.route)
        HStack(spacing: 10) {
            Text(recent.route)
                .font(Brand.number(17))
                .foregroundStyle(.white)
                .padding(.horizontal, 9).padding(.vertical, 5)
                .background(Theme.route(route), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            VStack(alignment: .leading, spacing: 1) {
                Text(recent.stationName).font(Brand.body(14, .bold)).foregroundStyle(Brand.ink).lineLimit(1)
                if let direction = recent.direction { Text(direction).font(Brand.body(11)).foregroundStyle(Brand.inkSoft) }
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .background(Brand.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Brand.line, lineWidth: 1))
        .shadow(color: Brand.ink.opacity(0.04), radius: 6, y: 2)
    }
}

// MARK: 작동 방식

/// 전광판 카드: 확률이 어떻게 나오는지 세 단계
struct HowItWorks: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 8) {
                SeatGlyph(color: Brand.led).frame(width: 18)
                Text("이렇게 알려드려요").font(Brand.title(17)).foregroundStyle(.white)
            }
            step(1, "버스 위치와 잔여석", "경기버스 정보를 2분마다 모아요")
            step(2, "평소 수요와 앞차", "1년치 승하차와 앞차가 남긴 사람까지 봐요")
            step(3, "도착할 때 몇 석, 내가 앉을 확률", "줄 선 사람을 빼고 계산해요")
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Brand.board, in: RoundedRectangle(cornerRadius: Brand.radius, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Brand.radius, style: .continuous).stroke(Brand.boardLine, lineWidth: 1))
    }

    private func step(_ number: Int, _ title: String, _ detail: String) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Text("\(number)")
                .font(Brand.number(24))
                .foregroundStyle(Brand.led)
                .frame(width: 26)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(Brand.body(15, .bold)).foregroundStyle(.white)
                Text(detail).font(Brand.body(13)).foregroundStyle(Brand.inkFaint)
            }
        }
    }
}
