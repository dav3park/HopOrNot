package kr.khu.bus.collector.config;

import java.time.LocalTime;
import java.util.ArrayList;
import java.util.List;
import java.util.OptionalInt;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/** 시각별 수집 간격을 계산한다. 구간이 겹치면 먼저 적힌 구간이 우선. */
@Component
public class CollectionSchedule {

    private static final Logger log = LoggerFactory.getLogger(CollectionSchedule.class);

    private record Slot(int startMin, int endMin, int intervalSeconds) {}

    private final List<Slot> slots = new ArrayList<>();

    public CollectionSchedule(CollectorProperties props) {
        for (CollectorProperties.Window w : props.windows()) {
            slots.add(new Slot(toMinutes(w.start()), toMinutes(w.end()), w.intervalSeconds()));
        }
        int routes = props.routes().size();
        int estimated = estimatedPollsPerDay() * routes;
        log.info("수집 스케줄 {}개 구간, 노선 {}개, 예상 호출 {}회/일 (한도 {})",
                slots.size(), routes, estimated, props.dailyLimit());
        if (estimated > props.dailyLimit()) {
            log.warn("예상 호출 수가 일일 한도를 넘습니다. 한도에 도달하면 그날 수집이 멈춥니다.");
        }
    }

    /** 지금 시각의 수집 간격(초). 수집 구간이 아니면 empty. */
    public OptionalInt intervalAt(LocalTime time) {
        int m = time.getHour() * 60 + time.getMinute();
        for (Slot s : slots) {
            if (m >= s.startMin() && m < s.endMin()) {
                return OptionalInt.of(s.intervalSeconds());
            }
        }
        return OptionalInt.empty();
    }

    public int estimatedPollsPerDay() {
        int total = 0;
        for (Slot s : slots) {
            int seconds = (s.endMin() - s.startMin()) * 60;
            total += (seconds + s.intervalSeconds() - 1) / s.intervalSeconds();
        }
        return total;
    }

    private static int toMinutes(String hhmm) {
        String[] p = hhmm.trim().split(":");
        int h = Integer.parseInt(p[0]);
        int m = Integer.parseInt(p[1]);
        if (h < 0 || h > 24 || m < 0 || m > 59 || (h == 24 && m != 0)) {
            throw new IllegalArgumentException("잘못된 시각: " + hhmm);
        }
        return h * 60 + m;
    }
}
