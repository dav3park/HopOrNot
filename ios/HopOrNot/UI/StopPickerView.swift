import SwiftUI

/// 노선 선택 (design/ 프로토타입의 노선 카드). 노선을 고르면 그 노선의 정류장 목록 화면으로 간다.
struct StopPickerView: View {
    @Environment(AppModel.self) private var model
    @State private var showSettings = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("경희대학교 국제캠퍼스 광역버스")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.secondary)
                    Text("노선 선택")
                        .font(.system(size: 34, weight: .heavy))
                        .tracking(-0.4)
                }
                .padding(.horizontal, 4)

                VStack(spacing: 12) {
                    ForEach(Route.allCases) { route in
                        NavigationLink(value: route) { routeCard(route) }
                            .buttonStyle(.plain)
                    }
                }

                LiveDot(label: "\(model.dataLabel) · 탈 확률은 내 정류장 기준 예측")
                    .frame(maxWidth: .infinity)
            }
            .padding(16)
        }
        .background(Theme.background)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { showSettings = true } label: { Image(systemName: "gearshape") }
                    .accessibilityLabel("설정")
            }
        }
        .sheet(isPresented: $showSettings) { SettingsView() }
    }

    private func routeCard(_ route: Route) -> some View {
        HStack(spacing: 14) {
            Image(systemName: "bus.fill")
                .font(.system(size: 24))
                .foregroundStyle(.white)
                .frame(width: 52, height: 52)
                .background(Theme.route(route), in: RoundedRectangle(cornerRadius: 14))
            VStack(alignment: .leading, spacing: 4) {
                RouteBadge(route: route)
                Text("\(route.terminals.0) ↔ \(route.terminals.1)")
                    .font(.system(size: 14))
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Image(systemName: "chevron.right").font(.system(size: 14, weight: .semibold)).foregroundStyle(.tertiary)
        }
        .padding(16)
        .frame(minHeight: 88)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
}
