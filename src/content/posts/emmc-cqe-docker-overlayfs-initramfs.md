---
title: "5만원짜리 홈서버가 initramfs에 빠진 날: eMMC, CQE, Docker overlayfs의 삼각지대"
published: 2026-07-21
description: "저가 eMMC 홈서버가 initramfs에 빠진 사건을 fsck, journald, Docker, CQE 관점에서 분석하고 부팅 시 쓰기 부하를 줄인 기록."
tags:
  - Homelab
  - eMMC
  - Docker
  - Linux
  - CQE
  - fsck
category: "DevOps / Troubleshooting"
lang: "ko"
draft: false
---

홈랩 서버 하나가 월요일 예약 재부팅 이후 정상 부팅하지 못하고 `initramfs` 셸에 떨어졌다. 루트 파일시스템은 `/dev/mmcblk0p2`였고, 수동 `fsck`가 필요한 상태였다.

결론부터 말하면, 단순히 “cron으로 재부팅해서 깨졌다”라기보다는 다음 조합이 더 그럴듯했다.

```text
저가 eMMC 컨트롤러
+ 부팅 직후 Docker/overlayfs 복구 쓰기
+ 커널 MMC CQE(Command Queue Engine) 불안정 가능성
+ 큰 journald 로그
+ 일부 컨테이너 crash loop
```

이 글은 홈랩에서 실제로 확인한 로그와 설정을 기반으로, 어떻게 원인을 좁히고 쓰기 부하를 줄였는지 정리한 기록이다. 완전한 하드웨어 분석은 아니지만, 비슷한 저가 미니 PC/eMMC 홈서버를 굴리는 사람에게는 꽤 재사용 가능한 체크리스트가 될 수 있다.

## 사건: 루트 파일시스템이 fsck를 요구했다

장비는 부팅 중 루트 파일시스템을 마운트하지 못하고 `initramfs`로 떨어졌다. 루트 파티션은 다음 장치였다.

```bash
/dev/mmcblk0p2
```

복구는 initramfs 셸에서 다음 명령으로 진행했다.

```bash
fsck -fy /dev/mmcblk0p2
```

`fsck` 종료 후에는 다음 메시지가 나왔다.

```text
FILE SYSTEM WAS MODIFIED
```

이 메시지는 실패가 아니라, `fsck`가 파일시스템 메타데이터를 실제로 수정했다는 뜻이다. 이후 `exit`로 부팅을 이어가면서 서버는 다시 올라왔다.

## 먼저 확인한 것

부팅 후에는 “왜 깨졌는가”를 보기 위해 루트 파일시스템, 로그 사용량, Docker 상태, 부트 파라미터를 확인했다.

```bash
findmnt -no SOURCE,FSTYPE,OPTIONS /
journalctl --disk-usage
docker info --format 'DockerRootDir={{.DockerRootDir}} LoggingDriver={{.LoggingDriver}}'
docker system df
cat /proc/cmdline
```

확인된 상태는 대략 이랬다.

```text
root: /dev/mmcblk0p2 ext4 rw,relatime,errors=remount-ro
journald: 3.9G
DockerRootDir: /var/lib/docker
Docker logging driver: json-file
Docker log opts: max-size=10m, max-file=3
Build cache: 3.335GB
```

Docker JSON 로그는 이미 `10m x 3`으로 제한되어 있었다. 즉 컨테이너 로그 설정 자체는 나쁘지 않았다. 반면 `journald`가 3.9GB까지 커져 있었고, Docker build cache도 꽤 컸다.

또 eMMC 장치 정보도 확인했다.

```bash
for f in /sys/block/mmcblk0/device/{name,type,life_time,pre_eol_info}; do
  [ -r "$f" ] && echo "$f=$(cat "$f")"
done
```

결과는 다음과 같았다.

```text
name=Y0S128
type=MMC
life_time=0x01 0x01
pre_eol_info=0x01
```

수명 지표만 보면 당장 수명이 끝난 상태는 아니었다. 하지만 이 값이 정상이라고 해서 컨트롤러/CQE/전원/부팅 타이밍 문제가 없다고 단정할 수는 없다. 특히 저가 eMMC는 성능과 안정성이 꽤 들쭉날쭉하다.

## 가설: 재부팅 그 자체보다 “다음 부팅의 쓰기 폭탄”

처음에는 월요일 cron 재부팅이 원인처럼 보였다. 하지만 정상적인 `systemctl reboot` 자체가 ext4를 바로 깨뜨리는 경우는 흔하지 않다.

더 수상한 쪽은 재부팅 이후였다.

Docker 호스트는 부팅 직후 다음 일을 한꺼번에 한다.

```text
systemd journal 초기화
Docker daemon 시작
기존 컨테이너 상태 복구
overlayfs mount/metadata 확인
컨테이너 로그 파일 열기
restart policy에 따른 컨테이너 재시작
```

이 서버는 루트 파일시스템이 eMMC 위에 있고, Docker root도 `/var/lib/docker`로 루트 eMMC 위에 있었다. 저가 eMMC 컨트롤러 입장에서는 부팅 직후 작은 랜덤 쓰기가 몰리는 구조다.

여기에 MMC CQE 문제가 섞이면 더 불안정해질 수 있다.

CQE(Command Queue Engine)는 MMC/eMMC에서 명령을 큐잉해 성능을 높이는 기능이다. 정상 컨트롤러와 정상 카드에서는 이득이 있지만, 일부 저가 컨트롤러/카드 조합에서는 커널 로그에 CQE recovery가 반복되거나 초기화 문제가 생기는 경우가 있다. 이때는 성능보다 안정성을 우선해 CQE를 끄는 편이 낫다.

## 조치 1: journald 상한 설정

먼저 journald가 계속 커지지 않도록 상한을 걸었다.

```ini
# /etc/systemd/journald.conf.d/10-emmc-write-limit.conf
[Journal]
Storage=persistent
Compress=yes
SystemMaxUse=512M
SystemKeepFree=1G
SystemMaxFileSize=64M
RuntimeMaxUse=128M
RuntimeMaxFileSize=32M
MaxRetentionSec=14day
```

적용 후 journald를 재시작하고 vacuum을 수행했다.

```bash
sudo systemctl restart systemd-journald
sudo journalctl --vacuum-size=512M
```

결과:

```text
journald: 3.9G -> 128.0M
```

로그는 운영에 필요하지만, 작은 eMMC 루트 디스크에서 무제한에 가깝게 커지는 건 좋지 않다.

## 조치 2: 루트 파일시스템에 noatime 적용

기존 루트 마운트 옵션은 `relatime`이었다.

```text
rw,relatime,errors=remount-ro
```

`/etc/fstab`의 루트 항목에 `noatime`을 추가했다.

```text
UUID=... / ext4 errors=remount-ro,noatime 0 1
```

그리고 즉시 remount했다.

```bash
sudo mount -o remount,noatime /
```

확인 결과:

```text
/dev/mmcblk0p2 ext4 rw,noatime,errors=remount-ro
```

`noatime`은 파일을 읽을 때 access time을 갱신하지 않게 해준다. 큰 성능 튜닝이라기보다는, 작은 플래시 저장장치에서 불필요한 쓰기를 줄이는 기본 방어선에 가깝다.

## 조치 3: MMC CQE 우회

GRUB 커널 파라미터에 다음 값을 추가했다.

```text
sdhci.debug_quirks2=0x4
```

설정 위치는 `/etc/default/grub`이다.

```bash
GRUB_CMDLINE_LINUX_DEFAULT="quiet splash sdhci.debug_quirks2=0x4"
```

이후 GRUB 설정을 재생성했다.

```bash
sudo update-grub
```

생성된 `/boot/grub/grub.cfg`에도 파라미터가 들어간 것을 확인했다.

```text
linux /boot/vmlinuz-... root=UUID=... ro quiet splash sdhci.debug_quirks2=0x4
```

이 설정은 현재 부팅에는 바로 적용되지 않는다. 다음 부팅 후 다음처럼 확인해야 한다.

```bash
cat /proc/cmdline | grep sdhci.debug_quirks2
```

이 옵션은 SDHCI 쪽 quirk를 통해 CQE를 broken 취급하게 하는 우회다. 성능은 일부 떨어질 수 있지만, 이 서버에서는 성능보다 부팅 안정성이 더 중요했다.

## 조치 4: Docker 시작을 30초 늦추기

부팅 직후 eMMC가 가장 바쁠 때 Docker가 바로 overlayfs와 컨테이너 상태를 복구하는 것을 줄이기 위해 Docker systemd override를 추가했다.

```ini
# /etc/systemd/system/docker.service.d/10-emmc-boot-settle.conf
[Service]
ExecStartPre=/bin/sleep 30
```

적용:

```bash
sudo systemctl daemon-reload
```

Docker를 즉시 재시작하지는 않았다. 이 설정은 다음 부팅부터 Docker 시작을 30초 지연시킨다.

촌스러워 보이지만, 저가 플래시 저장장치에서는 “한꺼번에 시작하지 않기”가 꽤 실용적인 안정화 전략이다.

## 조치 5: Docker build cache 정리

데이터 볼륨이나 실행 중인 이미지를 지우는 것은 위험하므로, 기본적으로 build cache만 정리했다.

```bash
docker builder prune -f
```

결과:

```text
Build Cache: 3.335GB -> 348.3MB
```

Docker 전체 사용량은 여전히 컸다.

```text
Images: 17.01GB
Local Volumes: 2.643GB
```

하지만 운영 데이터가 섞일 수 있는 볼륨은 건드리지 않았다. 장애 대응 중에는 “많이 지우기”보다 “안전하게 줄이기”가 우선이다.

## 조치 6: crash loop 중인 컨테이너 멈추기

추가로 `immich_server`가 계속 재시작 중인 것을 발견했다.

```text
immich_server Restarting (139)
RestartCount=21
ExitCode=139
```

`139`는 보통 SIGSEGV 계열이다. 이 컨테이너가 계속 죽고 살아나면 로그와 Docker 메타데이터 쓰기가 반복된다. 부팅 안정화가 우선이므로 crash loop만 멈췄다.

```bash
docker update --restart=no immich_server
docker stop -t 10 immich_server
```

결과:

```text
immich_server Exited (139)
RestartPolicy=no
```

데이터 삭제는 하지 않았다. Immich는 별도 장애로 보고 나중에 따로 고치면 된다.

## 최종 상태

조치 후 상태는 다음과 같았다.

```text
journald: 3.9GB -> 128MB
Docker build cache: 3.3GB -> 348MB
root mount: rw,noatime,errors=remount-ro
GRUB: sdhci.debug_quirks2=0x4 추가됨
Docker: 다음 부팅부터 시작 전 30초 대기
Immich crash loop: 중단
```

즉, 앞으로 부팅 때마다 다음 변화가 생긴다.

```text
CQE 우회로 eMMC 안정성 우선
Docker 시작 지연으로 부팅 직후 쓰기 집중 완화
noatime으로 파일 읽기 시 불필요한 쓰기 감소
journald 상한으로 로그 폭증 방지
crash loop 제거로 반복 쓰기 감소
```

## 남은 개선: Docker root를 eMMC 밖으로 빼기

이번 조치는 eMMC 위에서 최대한 안전하게 버티는 설정이다. 하지만 가장 좋은 해결책은 Docker root 자체를 eMMC 밖으로 빼는 것이다.

이 서버에는 `/mnt/usb`로 마운트된 외부 ext4 디스크가 있었다.

```text
/dev/sda1 ext4 /mnt/usb
```

장기적으로는 다음 방향이 더 낫다.

```text
/var/lib/docker  ->  /mnt/usb/docker-data
```

이렇게 하면 Docker overlayfs, 이미지, 컨테이너 메타데이터, 로그 대부분이 eMMC가 아니라 외부 디스크로 이동한다. 저가 eMMC 홈서버에서는 이게 근본적인 완화책에 가깝다.

단, Docker root 이전은 서비스 중단과 데이터 이동이 필요하므로 별도 작업으로 잡는 편이 안전하다.

## 다음 부팅 후 확인할 것

다음 재부팅 뒤에는 아래를 확인한다.

```bash
cat /proc/cmdline | grep sdhci.debug_quirks2
findmnt -no SOURCE,FSTYPE,OPTIONS /
dmesg -T | grep -Ei 'mmc|cqe|ext4|i/o|error'
journalctl -p err -b --no-pager
```

특히 `dmesg`에서 다음 패턴이 줄었는지 보는 게 중요하다.

```text
mmc timeout
CQE recovery
EXT4-fs error
Buffer I/O error
I/O error
```

## 마무리

이번 장애의 핵심은 “재부팅하면 깨진다”가 아니었다. 더 정확히는 “저가 eMMC 위에 Docker 홈서버를 올려두고, 부팅 직후 작은 쓰기 작업이 몰리는 구조”가 문제였다.

홈랩에서는 비싼 서버 장비보다 이런 작은 병목이 더 자주 터진다. 그래서 해결책도 거창한 HA 클러스터보다 먼저 다음처럼 현실적이어야 한다.

```text
로그 상한 걸기
불필요한 atime 쓰기 줄이기
부팅 시 서비스 시작 분산하기
불안정한 MMC 기능 끄기
crash loop 멈추기
쓰기 많은 경로를 eMMC 밖으로 빼기
```

5만원짜리 서버를 안정적으로 굴리는 방법은 마법이 아니다. 싸구려 부품이 싫어하는 패턴을 찾아서, 그 패턴을 줄이는 것이다.
