import SwiftUI

struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        @Bindable var model = model
        NavigationStack {
            Form {
                Section {
                    Picker("데이터", selection: $model.mode) {
                        ForEach(AppModel.Mode.allCases) { Text($0.label).tag($0) }
                    }
                    if model.mode == .live {
                        TextField("서버 주소 (https://…)", text: $model.serverURL)
                            .keyboardType(.URL)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                        SecureField("접근 키", text: $model.apiKey)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                    }
                } footer: {
                    Text(model.mode == .demo
                         ? "앱에 넣어 둔 과거 실제 데이터(\(DemoSource.meta?.label ?? ""))로 보여줍니다. 서버가 없어도 됩니다."
                         : "추론 서버의 주소와 접근 키. 시뮬레이터에서는 맥에서 띄운 서버를 http://localhost:8000 으로 부를 수 있습니다.")
                }
                Section {
                    Button("노선 다시 고르기") {
                        model.path = []
                        dismiss()
                    }
                }
            }
            .navigationTitle("설정")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("완료") { dismiss() } }
            }
        }
    }
}
