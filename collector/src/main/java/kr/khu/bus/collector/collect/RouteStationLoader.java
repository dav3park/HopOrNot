package kr.khu.bus.collector.collect;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.LocalDate;
import java.time.ZoneId;
import kr.khu.bus.collector.config.CollectorProperties;
import kr.khu.bus.collector.gbis.GbisClient;
import kr.khu.bus.collector.gbis.GbisResponse;
import kr.khu.bus.collector.notify.Notifier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

/** 시작할 때 route_station 이 비어 있는 노선만 정류장 목록을 받아 저장한다 (노선 조회 API 한도 사용). */
@Component
public class RouteStationLoader implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(RouteStationLoader.class);
    private static final String API = "route";

    private final CollectorProperties props;
    private final GbisClient client;
    private final QuotaGuard quota;
    private final ObservationRepository repo;
    private final Notifier notifier;
    private final ObjectMapper mapper;

    public RouteStationLoader(CollectorProperties props, GbisClient client, QuotaGuard quota,
                              ObservationRepository repo, Notifier notifier, ObjectMapper mapper) {
        this.props = props;
        this.client = client;
        this.quota = quota;
        this.repo = repo;
        this.notifier = notifier;
        this.mapper = mapper;
    }

    @Override
    public void run(ApplicationArguments args) {
        LocalDate today = LocalDate.now(ZoneId.of(props.zone()));
        for (CollectorProperties.Route route : props.routes()) {
            if (repo.countStations(route.routeId()) > 0) {
                continue;
            }
            if (!quota.tryAcquire(API, today)) {
                log.warn("노선 조회 한도 도달, {} 정류장 목록은 다음 시작 때 받습니다.", route.name());
                continue;
            }
            try {
                GbisResponse res = GbisResponse.parse(mapper, client.routeStations(route.routeId()),
                        "busRouteStationList");
                if (!res.ok() || res.items().isEmpty()) {
                    notifier.alert("stations-" + route.routeId(),
                            route.name() + " 정류장 목록 수신 실패: " + res.resultCode() + " " + res.message());
                    continue;
                }
                repo.insertStations(route.routeId(), res.items());
                notifier.info("stations-" + route.routeId(),
                        route.name() + " 정류장 " + res.items().size() + "개 저장");
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            } catch (Exception e) {
                notifier.alert("stations-" + route.routeId(), route.name() + " 정류장 목록 오류: " + e.getMessage());
            }
        }
    }
}
