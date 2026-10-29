# Checklist HLS trên TV box

## Phạm vi

- Chỉ FE `jozo-music-video`; không thay đổi API/BE, worker, R2 hoặc quy tắc chọn nguồn.
- Dùng bản FE có thay đổi mới; tải lại bản FE trên box trước khi kiểm thử. Build local không tự cập nhật website/box.
- Kiểm thử trong phòng dành riêng cho QA, không ngắt mạng router dùng chung hay điều khiển phòng khách đang sử dụng.
- Chuẩn bị: 2 bài có HLS ready (A/B), 1 bài không có HLS (C), thiết bị điều khiển cùng phòng.
- Không chỉnh database/catalog hoặc xóa file R2 để tạo lỗi. Muốn giả lập segment lỗi, chỉ chặn request trên browser QA qua DevTools/HTTP fixture.

## Tiêu chí chung

- Đánh giá thời gian tới **có cả hình lẫn tiếng**, không chỉ hết loading hoặc socket connected.
- Mục tiêu của box: dưới 3 giây; trên 4 giây ghi nhận chưa đạt, dù recovery sau đó có hoạt động.
- Khi mạng lỗi, không hứa vẫn phát ngay: kiểm tra thông báo, số lần retry hữu hạn và phục hồi sau khi mạng trở lại.
- Bản sửa hiện thông báo đang tải. Watchdog khoảng 8 giây không tiến triển; tối đa 2 lần tự recovery mỗi lượt bài. Nếu startup kẹt liên tục, dự kiến thử ở khoảng 8/16 giây và hiện “Thử lại” ở khoảng 24 giây (lỗi fatal có thể kích hoạt sớm hơn). Đây là giới hạn phục hồi khi lỗi, không phải mục tiêu tốc độ phát bình thường.
- Nếu attempt cuối tự phát lại sau khi nút retry đã hiện, lớp báo lỗi phải tự ẩn khi có tiến độ phát; không reload thêm chỉ vì lớp lỗi cũ.
- Không phát chồng YouTube/HLS, không tự chuyển bài do timeout, không tự bật lại bài đang pause, không mất lệnh seek/volume.
- Một bài kết thúc chỉ chuyển hàng đợi một lần. Bài chờ không được kết thúc bài trong queue.

## Các case chủ yếu trên box

| ID | Thao tác | Kết quả cần thấy |
| --- | --- | --- |
| H01 | Phát A; sau đó B; lặp A/B 10 lượt. Ghi riêng lần cold start. | Đúng bài, có hình + tiếng; không màn hình trống kéo dài; không chồng tiếng. Ghi số giây mỗi lượt. |
| H02 | Khi A đang phát, reload FE trên box nhiều lần (khuyến nghị 10). | Vẫn A, giữ vị trí theo trạng thái phòng; không thoáng phát bài khác, không mất nguồn HLS do REST/socket đến lệch thứ tự. |
| H03 | Pause A ở khoảng 30 giây rồi reload. Chờ ít nhất 15 giây trước khi Resume. | Vẫn pause đúng vị trí, không tự phát khi video ready hoặc recovery chạy; Resume mới có hình/tiếng tiếp. |
| H04 | A đang phát, ngắt mạng **chỉ box** khoảng 10–15 giây rồi bật lại. | Nếu còn buffer có thể phát tiếp. Nếu buffer cạn, recovery hữu hạn; khi mạng về tiếp tục gần vị trí dừng, không tự nhảy bài. Socket và video đều hoạt động lại. |
| H05 | Tạo stall dài hơn giới hạn recovery (trên browser QA có thể chặn segment), rồi trả mạng/request về bình thường và chọn “Thử lại”. | Có nút thử lại nhìn thấy và chọn được bằng remote/keyboard; không retry vô hạn, không gọi song_ended do timeout; retry có thể tải lại bài hiện tại. |
| H06 | Trong lúc A đang loading/recovery, chọn B; sau đó đợi thêm ít nhất 30 giây. | Chỉ B hoạt động; timer/callback cũ của A không pause/resume/retry/đánh dấu kết thúc B. |
| H07 | Thêm cùng bài A hai lượt liên tiếp, cho lượt đầu kết thúc tự nhiên. | Lượt thứ hai bắt đầu lại từ đầu, thấy hình và nghe tiếng; hết lượt hai chỉ chuyển queue một lần. |
| H08 | Đặt volume 0, đổi bài HLS hoặc reload; sau đó tăng volume. | Volume 0 giữ im lặng kể cả khi ready/recovery; tăng volume có tiếng lại. |
| H09 | Tắt mạng chỉ box; từ thiết bị điều khiển clear/để phòng hết bài; bật mạng box. | Sau reconnect FE dừng bài cũ, về màn hình chờ; không giữ HLS cũ. |
| H10 | Phát C không HLS, rồi A có HLS, rồi C. | C dùng luồng YouTube hiện có; A dùng HLS; chuyển nguồn không chồng tiếng hay mất điều khiển. |
| H11 | Khi A đang recovery: pause, seek sang vị trí khác, rồi trả mạng. | Giữ lệnh mới nhất; không tự resume khi pause, không quay về vị trí cũ trước seek. Sau Resume tiếp tục từ vị trí mới. |

## Case kỹ thuật trên máy QA (không bắt anh canh race bằng tay)

- REST về trước socket và socket về trước REST cùng bài/cùng HLS URL.
- REST cũ về sau socket chọn bài mới, clear hoặc pause: không ghi đè state mới.
- `now_playing_status` với `data:null` rõ ràng: về chờ; payload thiếu/malformed: không tự xóa bài.
- Manifest parsed nhưng chưa có dữ liệu video: chưa báo media ready.
- Stall/startup không fatal: recovery hữu hạn; callback/Promise cũ sau source change hoặc unmount bị bỏ qua.
- Reload tự động bảo toàn pause/seek/volume và không phát business event play/song_ended thay người dùng.

## Ghi nhận khi gặp lỗi

Gửi: ID case; bài/video ID; thao tác ngay trước lỗi; khoảng thời gian trống; có tiếng không; indicator connection có báo mất không; tự phục hồi hay phải bấm thử lại/reload; thời điểm lỗi để đối chiếu log. Nếu có thể, quay clip ngắn gồm màn hình và thao tác điều khiển.

Automated fixture tests không thay thế kiểm chứng frame/decoder, mạng và remote thật trên box. Chưa coi checklist này là đã pass trước khi thực hiện.
