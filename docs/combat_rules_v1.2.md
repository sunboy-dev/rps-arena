# Combat Rules Specification
**Version:** 1.2
**Status:** Draft for implementation (ตัวเลข Balance ผ่านการจำลอง Monte Carlo แล้ว)

## 1. Overview

ระบบต่อสู้แบบ 1 ต่อ 1 ใช้ Rock-Paper-Scissors (RPS) เป็นกลไกหลักในการตัดสินว่าใครได้สิทธิ์เลือก Action ในแต่ละ Turn โดยผู้เล่นเลือกมือจากการ์ดในมือ ไม่ใช่เลือกอิสระ ผู้เล่นต้องบริหาร HP, Mana, Angry Power, Combo, Cooldown และการ์ดในมือกับสำรับ เพื่อเอาชนะคู่ต่อสู้

เป้าหมายความยาวเกม: 30-50 Turn

### Design Principles

- RPS เป็นกลไกหลักที่กำหนดความได้เปรียบในแต่ละ Turn
- ผู้ชนะเลือก Action ได้ตามสถานการณ์ ไม่จำเป็นต้องโจมตีเสมอไป
- ชนิดการ์ดที่ใช้ชนะให้โบนัสต่างกัน (Hand Bonus) ผู้เล่นจึงเลือกมือตามแผน และคู่ต่อสู้อ่านแผนได้
- ผู้แพ้สะสม Angry Power เพื่อป้องกันตัว และ Angry ถูกซ่อน ผู้โจมตีจึงต้องเสี่ยง
- สกิลยิ่งใหญ่ยิ่งป้องกันยาก Large Skill ป้องกันไม่ได้
- Mana ใช้สำหรับ Special Skill เท่านั้น
- Combo ให้รางวัลแก่การชนะ RPS ติดต่อกัน
- สำรับที่จำกัดเป็นนาฬิกาของเกม กันไม่ให้เกมค้าง

## 2. Terminology

| Term | Definition |
|---|---|
| Turn | หนึ่งรอบ: จั่วการ์ด เลือกการ์ด ตัดสิน RPS ดำเนิน Action |
| Card | การ์ด 3 ชนิด: Rock, Paper, Scissors ใช้เป็นมือเป่ายิงฉุบ |
| Deck | สำรับของผู้เล่นแต่ละคน |
| Hand | การ์ดในมือ |
| Discard Pile | กองทิ้ง |
| Action | สิ่งที่ผู้ชนะ RPS เลือกทำ: Normal Attack, Charge Mana, Draw Action หรือ Special Skill |
| Special Skill | ความสามารถที่ใช้ Mana และมี Cooldown (รวม Heal) |
| Angry Power | ทรัพยากรที่ได้จากการแพ้ RPS ใช้สำหรับ Counter Attack และ Dodge |
| Defense | ปฏิกิริยาป้องกันของผู้แพ้: Counter Attack หรือ Dodge |
| Combo | จำนวนครั้งที่ชนะ RPS ติดต่อกัน |

## 3. Cards, Deck and Hand

### 3.1 Deck
- ทุกผู้เล่นได้สำรับ **60 ใบอัตโนมัติ: Rock 20, Paper 20, Scissors 20** (ไม่มีการสร้างสำรับเอง)
- สำรับถูกสับก่อนเริ่มเกม
- เมื่อสำรับหมด จั่วไม่ได้อีก และไม่มีการสับกองทิ้งกลับเข้าสำรับ

### 3.2 Hand
- เริ่มเกมจั่ว 5 ใบ
- จั่ว 1 ใบเมื่อเริ่มทุก Turn (ถ้าสำรับยังมีการ์ด)
- Hand Limit **10 ใบ** ถ้าเกินหลังการจั่วใดก็ตาม ต้องเลือกทิ้งให้เหลือ 10 ทันที การ์ดที่ทิ้งไปกองทิ้ง

### 3.3 Open-and-Keep (เปิด N เลือกเก็บ K)
ใช้กับ Draw Action และ Paper Bonus
1. เปิดการ์ดจากบนสำรับ N ใบ (ถ้าสำรับเหลือน้อยกว่า N เปิดเท่าที่มี)
2. เลือกเก็บ K ใบเข้ามือ
3. ใบที่เหลือคืนเข้าสำรับ แล้วสับเฉพาะสำรับ (ไม่รวมกองทิ้ง)
4. ตรวจ Hand Limit ทันที

## 4. Information Visibility

| ข้อมูล | เจ้าของเห็น | คู่ต่อสู้เห็น |
|---|---|---|
| HP, Mana, Cooldown ของสกิล | ✓ | ✓ |
| จำนวนการ์ดในมือ และในสำรับ | ✓ | ✓ |
| ชนิดการ์ดในมือ | ✓ | ✗ |
| การ์ดที่ลงใน RPS | ✓ | ✓ (เปิดพร้อมกัน แล้วไปกองทิ้ง) |
| การ์ดที่เปิดดูตอน Draw Action / Paper Bonus | ✓ | ✗ |
| การ์ดที่ทิ้งเพราะเกิน Hand Limit และกองทิ้ง | ✓ | ✗ |
| **Angry Power** | ✓ | **✗ (ซ่อน)** |
| Combo | ✓ | ✓ |

การซ่อน Angry คือกลไกหลักที่ทำให้ Counter และ Dodge เกิดขึ้นจริง ถ้าผู้โจมตีเห็น Angry จะเลี่ยงการโจมตีที่ถูกป้องกันได้เสมอ ดูหัวข้อ 16.3 และ Open Issue ข้อ 1

## 5. Turn Flow and RPS Resolution

1. ทั้งสองฝ่ายจั่ว 1 ใบ (ตรวจ Hand Limit)
2. ทั้งสองฝ่ายเลือกการ์ดจากมือพร้อมกัน แล้วเปิดเผยและทิ้ง
3. ตัดสินผล

| ผลลัพธ์ | กติกา |
|---|---|
| Win | ผู้ชนะเลือก Action หนึ่งอย่าง (หัวข้อ 6, 9) และได้ Hand Bonus (หัวข้อ 7) Combo +1 |
| Lose | Angry +1 (สูงสุด 7) และ Combo เป็น 0 ผู้แพ้อาจใช้ Defense ได้ถ้าถูกโจมตี (หัวข้อ 10) |
| Draw | ทั้งสองฝ่ายได้ +1 Mana ทันที ไม่มีการเลือก Action ไม่มี Hand Bonus Combo ไม่เปลี่ยน |

## 6. Actions

ผู้ชนะ RPS เลือกได้หนึ่งอย่าง:

| Action | ผล | ข้อจำกัด |
|---|---|---|
| Normal Attack | Damage 8 | ไม่ใช้ Mana ไม่มี Cooldown ผู้แพ้ป้องกันได้ด้วย Counter หรือ Dodge |
| Charge Mana | +1 Mana | - |
| Draw Action | เปิด 3 เลือกเก็บ 2 และ +1 Mana | เลือกไม่ได้เมื่อสำรับว่าง |
| Special Skill | ตามหัวข้อ 9 | Mana พอและไม่ติด Cooldown |

## 7. Hand Bonus

ผู้ชนะได้โบนัสตามชนิดการ์ดที่ใช้ชนะ ไม่ว่าจะเลือก Action ใด

| ชนะด้วย | โบนัส | หมายเหตุ |
|---|---|---|
| Rock | +25% Damage | ใช้กับ Normal Attack และสกิลที่ทำดาเมจ |
| Scissors | +1 Mana และฟื้น HP 5% ของ HP ที่เหลือ (ไม่เกิน 25% ของ Max HP) | ใช้หลัง Action เสร็จ ไม่เกิน Max HP |
| Paper | เปิด 2 เลือกเก็บ 1 ใบที่เหลือคืนสำรับแล้วสับ | ใช้หลัง Action เสร็จ ไม่มีผลถ้าสำรับว่าง |

- โบนัส Damage ทุกประเภท **บวกรวมกัน ไม่คูณ** เช่น Rock +25% และ Combo +50% = +75%
- ค่าที่คำนวณเป็นทศนิยมทั้งหมด (Damage, Heal) ปัดเป็นจำนวนเต็ม โดยปัด .5 ขึ้น
- Scissors Heal ตัวอย่าง: HP 80 ฟื้น 4, HP 30 ฟื้น 2 (1.5 ปัดขึ้น), HP 9 ฟื้น 0

## 8. Combo System

- ชนะ RPS: Combo +1
- แพ้: Combo เป็น 0
- เสมอ: Combo ไม่เปลี่ยน
- เมื่อ Combo ครบ **3** Combo Bonus ทำงานกับ Action ที่เลือกในชัยชนะครั้งนั้น แล้ว Combo กลับเป็น 0 ทันที

| Action | Combo Bonus |
|---|---|
| Normal Attack / สกิลทำดาเมจ | +50% Damage |
| Heal | ฟื้น x2 (24 HP) |
| Charge Mana | +3 Mana เพิ่มจากฐาน (รวม +4) |
| Draw Action | เปิด 4 เลือกเก็บ 2 (ยังได้ +1 Mana) |

## 9. Special Skills

### 9.1 Skills

| Skill | Tier | Cooldown | Mana Cost | Effect |
|---|---|---:|---:|---|
| Heal | Small | 5 | **2** | ฟื้นฟู 12 HP (ไม่เกิน Max HP) |
| Quick Strike | Small | 5 | 4 | Damage 10 |
| Heavy Strike | Medium | 7 | 5 | Damage 16 |
| Ultimate | Large | 9 | 7 | Damage 26 |

- Heal มี Mana Cost แยกจาก Tier (สกิลโจมตี Small ใช้ 4 แต่ Heal ใช้ 2)
- Quick Strike, Heavy Strike และ Ultimate เป็นสกิลตัวอย่างสำหรับซิม เปลี่ยนชื่อและเอฟเฟกต์ได้ ตราบใดที่ Tier ยังกำหนดการป้องกันตามหัวข้อ 10

### 9.2 Requirements
Mana เพียงพอ, สกิลไม่ติด Cooldown และผู้ใช้เป็นผู้ชนะ RPS ใน Turn นั้น ถ้าไม่ครบ ระบบไม่อนุญาตให้ใช้

### 9.3 Cooldown
- แยกรายสกิล การใช้สกิลหนึ่งไม่ทำให้สกิลอื่นติด Cooldown
- เริ่มนับเมื่อสกิลถูกใช้จริง และ Turn ที่ใช้ไม่นับเป็น Turn ที่ผ่านไป
- ลดลง 1 ทุกท้าย Turn (รวม Turn ที่เสมอหรือแพ้)

| Turn | Small Skill (Cooldown 5) ที่ใช้ใน Turn 1 |
|---|---|
| 1 | ใช้สกิล |
| 2-6 | ใช้ไม่ได้ |
| 7 | กลับมาใช้ได้ |

Medium และ Large ใช้หลักเดียวกันที่ 7 และ 9 Turn

## 10. Angry Power and Defense

### 10.1 Angry Power
- สูงสุด **7** Stack
- แพ้ RPS: +1 Stack
- Angry ที่ได้ใน Turn นี้ **ใช้ได้ตั้งแต่ Turn ถัดไป** การป้องกันใน Turn ใดอ้างอิงค่า Angry ณ ต้น Turn
- ไม่ลดเองตามเวลา
- **ซ่อนจากคู่ต่อสู้**

### 10.2 Defense Table

ต้องมี Angry อย่างน้อยเท่า Cost และหัก Stack เท่า Cost เมื่อใช้ ส่วน Stack ที่เหลือเก็บไว้

| โจมตีด้วย | Counter Attack | Dodge |
|---|---|---|
| Normal Attack | ได้ (Cost 5) | ได้ (Cost 3) |
| Small Skill (Quick Strike) | ไม่ได้ | ได้ (Cost 5) |
| Medium Skill (Heavy Strike) | ไม่ได้ | ได้ (Cost 7) |
| Large Skill (Ultimate) | ไม่ได้ | ไม่ได้ |
| Heal / Charge Mana / Draw Action | - | - |

- ผู้แพ้เลือกใช้ Defense หรือไม่ก็ได้ ใช้ได้หนึ่งอย่างต่อการโจมตี
- ผู้แพ้ตัดสินใจหลังรู้ว่าผู้ชนะเลือก Action ใด

### 10.3 Counter Attack
- ยกเลิกความเสียหายทั้งหมดของ Normal Attack
- โจมตีกลับด้วย Damage 8 (ไม่รวม Hand Bonus และ Combo Bonus ใด ๆ)
- หัก Angry 5 Stack
- การโจมตีกลับ Counter ซ้ำไม่ได้ และไม่สามารถถูก Dodge

### 10.4 Dodge
- ยกเลิกความเสียหายทั้งหมดของการโจมตีนั้น ไม่โจมตีกลับ
- หัก Angry ตาม Cost ในตาราง 10.2

## 11. Mana

- เริ่มเกม 2, สูงสุด **15**
- แหล่งที่มา

| แหล่ง | Mana |
|---|---:|
| Charge Mana | +1 |
| Charge Mana + Combo Bonus | +4 |
| Draw Action | +1 |
| RPS Draw (ทั้งสองฝ่าย) | +1 |
| Scissors Bonus | +1 |

- ใช้กับ Special Skill ตาม Mana Cost เท่านั้น
- Scissors Bonus บวกหลังหัก Mana Cost ของสกิลใน Turn นั้น

## 12. Damage

`Damage = Base × (1 + Hand Bonus + Combo Bonus)` ปัดเป็นจำนวนเต็ม (.5 ปัดขึ้น)

| Action | Base |
|---|---:|
| Normal Attack | 8 |
| Counter Attack | 8 (ไม่มีโบนัส) |
| Quick Strike | 10 |
| Heavy Strike | 16 |
| Ultimate | 26 |

ตัวอย่าง: ชนะด้วย Rock ครบ Combo 3 แล้วใช้ Ultimate = 26 × 1.75 = 45.5 → 46

ระบบ ATK/DEF จากสเปก v1.0 ยังเลื่อนไว้ ถ้านำกลับมา ให้ใช้ `Base = max(1, ATK - DEF)` ก่อนคูณโบนัส

HP ต้องไม่ต่ำกว่า 0 และไม่เกิน Max HP

## 13. End of Battle

ตรวจท้าย Turn หลังประมวลผลครบ
1. HP ของฝ่ายใดเป็น 0: เกมจบ ฝ่ายที่ HP เหลือชนะ ถ้าเป็น 0 ทั้งคู่ เสมอ
2. ฝ่ายใดฝ่ายหนึ่ง (หรือทั้งคู่) ลงการ์ดใบสุดท้ายในมือใน Turn นั้น: เกมจบหลัง Turn นั้นประมวลผลครบ ฝ่ายที่ HP มากกว่าชนะ เท่ากันเสมอ

## 14. Turn Resolution Order

1. ทั้งสองฝ่ายจั่ว 1 ใบ และตรวจ Hand Limit
2. เลือกการ์ดพร้อมกัน เปิดเผย และทิ้ง
3. บันทึก Angry ณ ต้น Turn ของทั้งสองฝ่าย (ใช้สำหรับ Defense ใน Turn นี้)
4. ตัดสิน Win / Lose / Draw
5. ถ้า Draw: ทั้งสองฝ่าย +1 Mana แล้วข้ามไปข้อ 12
6. อัปเดต Combo ของทั้งสองฝ่าย และ Angry +1 ของผู้แพ้
7. ตรวจ Combo Bonus (Combo ครบ 3) แล้ว Combo กลับเป็น 0
8. ผู้ชนะเลือก Action ถ้าเป็นสกิล ตรวจ Mana และ Cooldown หัก Mana และเริ่ม Cooldown
9. ถ้าเป็นการโจมตี: คำนวณ Damage จาก Hand Bonus และ Combo Bonus ผู้แพ้เลือก Defense ตามตาราง 10.2 (อ้างอิง Angry จากข้อ 3) แล้วใช้ผล
10. ถ้าไม่ใช่การโจมตี: ใช้ผลของ Heal, Charge Mana หรือ Draw Action
11. ใช้ Hand Bonus ที่ไม่ใช่ Damage: Scissors (+1 Mana, Heal) และ Paper (เปิด 2 เก็บ 1)
12. ลด Cooldown ของทุกสกิลที่ไม่ได้ใช้ใน Turn นี้ลง 1
13. ตรวจเงื่อนไขจบเกม (หัวข้อ 13)
14. บันทึกประวัติ Turn

ต้องให้การอัปเดตสถานะเกิดเพียงครั้งเดียวต่อเหตุการณ์ เพื่อป้องกันการได้รับโบนัสหรือหักทรัพยากรซ้ำ

## 15. Balance Parameters

ค่าทั้งหมดควรแยกเป็น Configuration เพื่อปรับสมดุลได้โดยไม่ต้องแก้กฎหลัก

| Parameter | Value |
|---|---|
| Max HP | 100 |
| Mana เริ่มต้น / สูงสุด | 2 / 15 |
| Normal Attack / Counter Attack Damage | 8 / 8 |
| Skill Damage (Quick / Heavy / Ultimate) | 10 / 16 / 26 |
| Heal Amount | 12 |
| Skill Mana Cost (Heal / Quick / Heavy / Ultimate) | 2 / 4 / 5 / 7 |
| Skill Cooldown (Small / Medium / Large) | 5 / 7 / 9 |
| Charge Mana | +1 |
| RPS Draw Mana | +1 ทั้งสองฝ่าย |
| Draw Action | เปิด 3 เก็บ 2, +1 Mana |
| Rock Bonus | +25% Damage |
| Scissors Bonus | +1 Mana, Heal 5% ของ HP ที่เหลือ (cap 25% Max HP) |
| Paper Bonus | เปิด 2 เก็บ 1 |
| Combo Threshold | 3 |
| Combo Bonus | Damage +50%, Heal x2, Charge +3, Draw เปิด 4 |
| Angry Max / ได้ต่อการแพ้ | 7 / +1 |
| Angry Visibility | ซ่อน |
| Counter Cost | 5 |
| Dodge Cost (Normal / Small / Medium) | 3 / 5 / 7 |
| Deck | 60 ใบ (Rock 20, Paper 20, Scissors 20) |
| Start Hand / Draw per Turn / Hand Limit | 5 / 1 / 10 |

## 16. Simulation Results

จำลองด้วย Monte Carlo โดยบอทที่ใช้กฎตัดสินใจแบบง่าย ผลจึงบอกแนวโน้ม ไม่ใช่ผลของผู้เล่นจริง สคริปต์: `combat_sim.py` (ค่าเริ่มต้นตรงกับหัวข้อ 15) และ `bot_levels.py`

### 16.1 ผลหลัก (ต่อผู้เล่นต่อเกม คู่ละ 3,000 เกม)

| ตัวชี้วัด | smart vs smart | expert vs expert |
|---|---|---|
| ความยาวเกมเฉลี่ย | 42.0 Turn (p10 = 28, p90 = 55) | 43.8 Turn |
| จบด้วย HP เป็น 0 / การ์ดหมด | 80% / 20% | 66% / 34% |
| Counter / Dodge | 0.86 / 1.86 | 0.33 / 3.10 |
| Counter + Dodge | 2.72 | 3.43 |
| Combo Bonus | 1.78 | 2.24 |
| HP ที่ฟื้นจาก Scissors | 10 | 10 |
| ใช้ Heal / สกิลโจมตี (ครั้ง) | 1.9 / 2.9 | 2.2 / 2.8 |
| สัดส่วนดาเมจ | Normal 40%, Ultimate 32%, Heavy 27%, Quick 1% | Normal 42%, Ultimate 33% |
| Mana เฉลี่ย | 3.6 | 3.5 |

### 16.2 ทัวร์นาเมนต์บอท 7 ระดับ (ทุกคู่ คู่ละ 1,500 เกม)

| อันดับ | บอท | ลักษณะ | ชนะเฉลี่ย |
|---|---|---|---:|
| 1 | expert | นับการ์ด อ่านนิสัยคู่ต่อสู้ ป้องกันตามมูลค่า | 71% |
| 2 | reader | นับการ์ด | 58% |
| 3 | smart | ให้คะแนน Action แบบฮิวริสติก | 57% |
| 4 | turtle | ฟื้นบ่อย เก็บ Mana | 53% |
| 5 | aggro | โจมตีอย่างเดียว | 50% |
| 6 | greedy | โจมตีแรงสุด ป้องกันทุกครั้ง | 49% |
| 7 | random | สุ่ม | 13% |

- ฝีมือมีผลชัดเจน และไม่มีสไตล์ใดครองเกม
- ความได้เปรียบของ expert มาจากการอ่านนิสัยการเลือกการ์ดของคู่ต่อสู้เป็นหลัก

### 16.3 ผลเมื่อผู้เล่นติดตาม Angry ได้

| ผู้โจมตีรู้ค่า Angry ถูก | Counter + Dodge (smart / expert) | ความยาวเกม | จบด้วย HP เป็น 0 |
|---|---|---|---|
| 0% (ซ่อนสมบูรณ์) | 2.72 / 3.43 | 42-44 | 66-80% |
| 50% | 2.25 / 2.80 | 46 | 51-58% |
| 80% | 1.43 / 1.91 | 47-48 | 35-38% |
| เปิดเผย Angry (เทียบ) | ต่ำกว่า 1 | 41-47 | 32-67% |

### 16.4 Open Issues

1. **Angry ยังคำนวณย้อนได้** ผลแพ้ RPS และการใช้ Defense เปิดเผย ผู้เล่นที่นับเก่งจึงรู้ค่า Angry ได้ ทำให้ Counter/Dodge ลดลงและเกมยาวขึ้นตามตาราง 16.3 ควรเพิ่มแหล่ง Angry ที่อีกฝ่ายมองไม่เห็นอย่างน้อยหนึ่งทาง เช่น Angry +1 ต่อการ์ดที่ทิ้งเพราะเกิน Hand Limit (ยังไม่ได้ซิม)
2. **Quick Strike แทบไม่มีใครใช้** (0.06 ครั้งต่อเกม) เพราะ Damage 10 แลก Mana 4 แต่ Normal Attack ได้ 8 ฟรี ควรเพิ่ม Damage (เช่น 14) ลด Cost หรือเพิ่มเอฟเฟกต์
3. **เกมแนวตั้งรับยืดเยื้อ** turtle vs turtle เฉลี่ย 54.6 Turn และจบด้วย HP เพียง 7% เพราะ Heal ถูก (Mana 2) ร่วมกับ Scissors Heal ไม่ได้ทำให้ turtle ชนะมากขึ้น แต่ทำให้เกมระหว่างผู้เล่นตั้งรับน่าเบื่อ
4. **Scissors Heal cap ไม่มีผล** 5% ของ HP ที่เหลือไม่มีวันเกิน 25% ของ Max HP และการคิดจาก HP ที่เหลือทำให้คนที่ HP มากฟื้นมากกว่า ถ้าตั้งใจให้ช่วยฝ่ายที่ตามอยู่ ควรคิดจาก HP ที่หายไปแทน
5. **การ์ดหมดจบเกม 20-34%** ใกล้ขอบบนของเป้า ถ้าต้องการให้จบด้วย HP มากขึ้น ลอง Max HP 90-95 (ยังไม่ได้ซิม)
6. **บอท expert แทบไม่ใช้ Counter** (0.33 ครั้ง) เลือก Dodge ที่ถูกกว่าเป็นหลัก ควรติดตามในการทดสอบกับผู้เล่นจริง

## 17. Acceptance Criteria

**Deck and Hand**
- ทุกผู้เล่นได้สำรับ 60 ใบ: Rock 20, Paper 20, Scissors 20 และสำรับถูกสับก่อนเริ่ม
- เริ่มเกมจั่ว 5 ใบ และจั่ว 1 ใบทุกต้น Turn เมื่อสำรับยังมี
- มือเกิน 10 ใบหลังการจั่วใดก็ตาม ผู้เล่นทิ้งจนเหลือ 10 และการ์ดไปกองทิ้ง
- สำรับหมดแล้วจั่วไม่ได้ ไม่มีการสับกองทิ้งกลับ Draw Action เลือกไม่ได้ และ Paper Bonus ไม่มีผล
- Open-and-Keep คืนการ์ดที่ไม่เก็บเข้าสำรับแล้วสับเฉพาะสำรับ

**Visibility**
- คู่ต่อสู้เห็นจำนวนการ์ดในมือและสำรับ HP, Mana, Cooldown และ Combo แต่ไม่เห็นชนิดการ์ดในมือและ Angry

**RPS**
- เสมอ: ทั้งสองฝ่าย +1 Mana ไม่มี Action ไม่มี Hand Bonus Combo ไม่เปลี่ยน
- แพ้: Angry +1 (ไม่เกิน 7) Combo เป็น 0 และ Angry ที่ได้ใช้ได้ตั้งแต่ Turn ถัดไป
- ชนะติดต่อกัน 3 ครั้ง (นับข้ามการเสมอ) ได้ Combo Bonus ตามตารางหัวข้อ 8 แล้ว Combo เป็น 0

**Actions and Bonuses**
- Normal Attack 8, Charge Mana +1, Draw Action เปิด 3 เก็บ 2 และ +1 Mana
- Rock +25% Damage, Scissors +1 Mana และฟื้น 5% ของ HP ที่เหลือ, Paper เปิด 2 เก็บ 1
- โบนัส Damage บวกกันแบบ Additive และปัดเศษ .5 ขึ้น

**Skills and Mana**
- Mana Cost: Heal 2, Quick 4, Heavy 5, Ultimate 7 และ Cooldown 5 / 7 / 9
- ใช้สกิลไม่ได้เมื่อ Mana ไม่พอหรือ Cooldown ยังเหลือ
- Mana ไม่เกิน 15 และ HP ไม่เกิน Max HP

**Defense**
- Counter ใช้ได้กับ Normal Attack เท่านั้น ต้องมี Angry ≥ 5 หัก 5 ยกเลิกดาเมจและโจมตีกลับ 8
- Dodge: Normal ต้อง ≥ 3 หัก 3, Small ต้อง ≥ 5 หัก 5, Medium ต้อง 7 หัก 7
- Large Skill ป้องกันไม่ได้
- Defense ใช้ค่า Angry ณ ต้น Turn

**End of Battle**
- HP เป็น 0 จบเกม และเมื่อมีฝ่ายลงการ์ดใบสุดท้าย เกมจบหลัง Turn นั้นประมวลผลครบ ฝ่ายที่ HP มากกว่าชนะ เท่ากันเสมอ

## Changelog

### v1.2
- Hand Limit เพิ่มจาก 7 เป็น 10 ใบ
- Angry Power ซ่อนจากคู่ต่อสู้
- สกิลโจมตีใช้ Mana +2 (Quick 4, Heavy 5, Ultimate 7) แต่ Heal ใช้ 2
- Scissors Bonus เพิ่มการฟื้น HP 5% ของ HP ที่เหลือ
- Counter Cost 5, Dodge Cost แยกตามชนิดการโจมตี (3 / 5 / 7)
- Cooldown +1 ทุกระดับ เป็น 5 / 7 / 9
- RPS Draw: ทั้งสองฝ่าย +1 Mana อย่างเดียว ตัดตัวเลือก Draw Action
- Draw Action: เปิด 3 เก็บ 2 และ +1 Mana
- Charge Mana +1, Combo Mana +3, Mana สูงสุด 15
- Angry สูงสุด 7
- ตัด Attack Streak
- สำรับ 20/20/20 อัตโนมัติ ตัดระบบสร้างสำรับเอง

### v1.1
- เปลี่ยนจากเป่ายิงฉุบอิสระเป็นการเลือกการ์ดจากมือ พร้อมสำรับ, Hand Limit และ Draw Action
- Heal ย้ายจาก Action ไปเป็น Small Skill
- เพิ่ม Hand Bonus และ Combo Bonus ตาม Action ที่เลือก
- Combo Threshold 3 และเสมอไม่รีเซ็ต Combo
- Dodge ใช้ป้องกันสกิลได้ตาม Tier, Large Skill ป้องกันไม่ได้
- Angry ใช้ได้ตั้งแต่ Turn ถัดไป
- เงื่อนไขจบเกมเมื่อการ์ดหมด
