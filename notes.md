Production mein agar reservations ka expiry hona business ke liye critical hai, to sirf setInterval() par depend mat rehna. Payment/order create karte waqt expiry validate karo aur har relevant request par bhi expired reservation ki condition check karo. Worker ko cleanup aur timely updates ke liye use kar sakte ho.


6. Internet disconnect aur app background handling
- Answers ko periodically save karo.
- Network reconnect hone par saved progress restore ho.
- Duplicate submit requests se double scoring na ho.
- App background/foreground events server par record kiye ja saken.
- Background hone ko automatically cheating declare mat karo; genuine phone calls ya network problems bhi ho sakte hain.
Background count ko cheating signal ki tarah use karo, final proof ki tarah nahi.

9. Performance aur server reliability
Socho 1,000 students ek saath 8 PM par test start karte hain.
- Database indexes sahi hon.
- Contest list, questions aur leaderboard APIs optimized hon.
- Concurrent submissions aur duplicate requests handle hon.
- Error logs, backups aur server monitoring enabled hon.
- Peak-load testing real launch se pehle ho.
Sirf local machine par 5–10 users se test karke production-ready declare mat karna.


8. Support, cancellation aur refund policy
Student ko clearly pata hona chahiye:
- Contest cancel ho gaya to kya hoga?
- Payment deduct hua lekin enrollment nahi dikha to kya kare?
- Galat score ya technical issue report kaise kare?
- Refund eligible hai ya nahi aur kitna time lag sakta hai?
App mein support contact aur complaint tracking dena trust build karta hai.