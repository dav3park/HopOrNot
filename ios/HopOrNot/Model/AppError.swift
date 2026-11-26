import Foundation

/// 화면에 보여 줄 오류. 시스템 오류 문구("취소됨" 등)를 그대로 보여 주지 않고 사람이 읽을 말로 바꾼다.
struct AppError: Equatable, Error {
    enum Kind: Equatable {
        case offline, timeout, unreachable, unauthorized, server(Int), badData, other
    }

    let kind: Kind
    let title: String
    let message: String
    let symbol: String

    /// 다시 시도하면 나아질 수 있는 오류인가 (접근 키가 틀린 경우는 아니다)
    var isRetryable: Bool { kind != .unauthorized }

    init(_ error: Error) {
        if let known = error as? AppError { self = known; return }
        if let source = error as? DataSourceError {
            switch source {
            case .server(401, _):
                self.init(.unauthorized, "접근 키가 올바르지 않아요", "설정에서 접근 키를 확인해 주세요.", "key.slash")
            case .server(let code, _) where code >= 500:
                self.init(.server(code), "서버에 문제가 생겼어요", "잠시 뒤 다시 시도해 주세요. (오류 \(code))", "exclamationmark.icloud")
            case .server(let code, _):
                self.init(.server(code), "요청을 처리하지 못했어요", "오류 \(code)", "exclamationmark.triangle")
            case .missingDemo:
                self.init(.badData, "데모 데이터가 없어요", "이 정류장의 데모 데이터가 앱에 들어 있지 않아요.", "tray")
            }
            return
        }
        if error is DecodingError {
            self.init(.badData, "데이터를 읽지 못했어요", "서버가 보낸 형식이 앱과 달라요. 앱을 업데이트해야 할 수 있어요.", "doc.questionmark")
            return
        }
        if let url = error as? URLError {
            switch url.code {
            case .notConnectedToInternet, .networkConnectionLost, .dataNotAllowed, .internationalRoamingOff:
                self.init(.offline, "인터넷에 연결되어 있지 않아요", "연결을 확인하면 자동으로 다시 불러와요.", "wifi.slash")
            case .timedOut:
                self.init(.timeout, "서버 응답이 늦어요", "잠시 뒤 다시 불러올게요.", "clock.badge.exclamationmark")
            case .cannotFindHost, .cannotConnectToHost, .dnsLookupFailed, .secureConnectionFailed, .serverCertificateUntrusted,
                 .serverCertificateHasBadDate, .appTransportSecurityRequiresSecureConnection:
                self.init(.unreachable, "서버에 연결할 수 없어요", "서버 주소와 네트워크를 확인해 주세요.", "server.rack")
            default:
                self.init(.other, "불러오지 못했어요", "잠시 뒤 다시 시도해 주세요.", "exclamationmark.triangle")
            }
            return
        }
        self.init(.other, "불러오지 못했어요", "잠시 뒤 다시 시도해 주세요.", "exclamationmark.triangle")
    }

    private init(_ kind: Kind, _ title: String, _ message: String, _ symbol: String) {
        self.kind = kind
        self.title = title
        self.message = message
        self.symbol = symbol
    }

    /// 화면이 바뀌어 요청이 취소된 것은 오류가 아니다. 사용자에게 보여 주지 않는다.
    static func isCancellation(_ error: Error) -> Bool {
        if error is CancellationError { return true }
        if let url = error as? URLError, url.code == .cancelled { return true }
        return (error as NSError).domain == NSURLErrorDomain && (error as NSError).code == NSURLErrorCancelled
    }
}

/// 한 가지 데이터(정류장 목록, 정류장 화면, 홈 요약)를 불러오는 상태
enum LoadStatus: Equatable {
    case idle
    case loading
    case ok(Date)
    case failed(AppError)

    var error: AppError? {
        if case .failed(let error) = self { return error }
        return nil
    }

    var isLoading: Bool { self == .loading }
}
