package kr.khu.bus.collector.collect;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.HashMap;
import java.util.Map;
import java.util.OptionalInt;
import kr.khu.bus.collector.config.CollectionSchedule;
import kr.khu.bus.collector.config.CollectorProperties;
import kr.khu.bus.collector.gbis.GbisClient;
import kr.khu.bus.collector.gbis.GbisResponse;
import kr.khu.bus.collector.notify.Notifier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 10초마다 깨어나서, 지금 시각의 수집 간격이 지났으면 모든 노선의 버스위치를 한 번씩 수집한다.
 */
@Component
public class LocationCollector {

    static final String API = "location";
    private static final Logger log = LoggerFactory.getLogger(LocationCollector.class);
    private static final int ALERT_AFTER_FAILURES = 3;

    private final CollectorProperties props;
    private final CollectionSchedule schedule;
    private final GbisClient client;
    private final QuotaGuard quota;
    private final ObservationRepository repo;
    private final Notifier notifier;
    private final ObjectMapper mapper;
    private final ZoneId zone;
    private final LocalDate storeRawUntil;

    private final Map<Long, Integer> consecutiveFailures = new HashMap<>();
    private Instant lastPoll;

    public LocationCollector(CollectorProperties props, CollectionSchedule schedule, GbisClient client,
                             QuotaGuard quota, ObservationRepository repo, Notifier notifier,
                             ObjectMapper mapper) {
        this.props = props;
        this.schedule = schedule;
        this.client = client;
        this.quota = quota;
        this.repo = repo;
        this.notifier = notifier;
        this.mapper = mapper;
        this.zone = ZoneId.of(props.zone());
        this.storeRawUntil = (props.storeRawUntil() == null || props.storeRawUntil().isBlank())
                ? null : LocalDate.parse(props.storeRawUntil().trim());
    }

    @Scheduled(fixedDelay = 10_000, initialDelay = 15_000)
    public void tick() {
        ZonedDateTime now = ZonedDateTime.now(zone);
        OptionalInt interval = schedule.intervalAt(now.toLocalTime());
        if (interval.isEmpty()) {
            return;
        }
        if (lastPoll != null && Duration.between(lastPoll, now.toInstant()).getSeconds() < interval.getAsInt()) {
            return;
        }
        lastPoll = now.toInstant();
        for (CollectorProperties.Route route : props.routes()) {
            collect(route, now);
        }
    }

    private void collect(CollectorProperties.Route route, ZonedDateTime now) {
        LocalDate today = now.toLocalDate();
        String body = null;
        Exception lastError = null;

        for (int attempt = 1; attempt <= 2 && body == null; attempt++) {
            if (!quota.tryAcquire(API, today)) {
                notifier.alert("quota-" + today, "오늘 위치정보 호출 한도(" + quota.dailyLimit()
                        + "회)에 도달해 수집을 멈췄습니다. 자정에 다시 시작합니다.");
                return;
            }
            try {
                body = client.busLocations(route.routeId());
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            } catch (Exception e) {
                lastError = e;
                sleepQuietly(3_000);
            }
        }

        if (body == null) {
            fail(route, "호출 실패: " + (lastError == null ? "unknown" : lastError.getMessage()));
            return;
        }

        try {
            GbisResponse res = GbisResponse.parse(mapper, body, "busLocationList");
            if (!res.ok()) {
                fail(route, "API 오류 " + res.resultCode() + " " + res.message());
                return;
            }
            OffsetDateTime collectedAt = now.toOffsetDateTime();
            repo.insertObservations(collectedAt, res.queryTime(), route.routeId(), res.items());
            if (storeRawUntil != null && !today.isAfter(storeRawUntil)) {
                repo.insertRaw(collectedAt, API, route.routeId(), body);
            }
            consecutiveFailures.put(route.routeId(), 0);
            log.debug("{} 차량 {}대 저장", route.name(), res.items().size());
        } catch (Exception e) {
            fail(route, "저장/해석 실패: " + e.getMessage());
        }
    }

    private void fail(CollectorProperties.Route route, String reason) {
        int n = consecutiveFailures.merge(route.routeId(), 1, Integer::sum);
        log.warn("{}({}) {} (연속 {}회)", route.name(), route.routeId(), reason, n);
        if (n >= ALERT_AFTER_FAILURES) {
            notifier.alert("fail-" + route.routeId(), route.name() + " 수집이 연속 " + n + "회 실패: " + reason);
        }
    }

    private static void sleepQuietly(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
