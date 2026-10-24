"""Generates the two GOROVIAN shop-import fixtures. Headers/sheet names follow
server/services/shopImportExcelParser.ts. Run: python3 generate_fixtures.py"""
import os, random
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
random.seed(11)
HERE = os.path.dirname(os.path.abspath(__file__))

PCOLS = ["Product name","Product SKU","Variant SKU","Variant name","Category","Brand","Unit",
         "Size","Color","Barcode","Cost price","Selling price","Min stock","Track stock"]
BLK=("BLK","Black");NVY=("NVY","Navy");CHR=("CHR","Charcoal");BLU=("BLU","Blue");WHT=("WHT","White");BRN=("BRN","Brown")
RED=("RED","Red");GRN=("GRN","Green");GRY=("GRY","Grey");BEG=("BEG","Beige");DBL=("DBL","Dark Blue")
# prefix,no,name,category,brand,unit,cost,markup,sizes,colours|fragrances,mode
P=[
("SU",1,"Slim Fit Two-Piece Suit","Suits","Marvin Tailors","pcs",9500,.45,["40R","42R","44R"],[BLK,NVY],"color"),
("SU",2,"Classic Three-Piece Suit","Suits","Savile Row KE","pcs",12500,.45,["42R","44R"],[CHR],"color"),
("JN",1,"Straight Leg Denim Jeans","Jeans","Denimark","pcs",1400,.55,["30","32","34"],[BLU,BLK],"color"),
("JN",2,"Skinny Stretch Jeans","Jeans","Urban Thread","pcs",1300,.55,["28","30"],[DBL],"color"),
("SH",1,"Leather Formal Shoes","Shoes","Kenwood Footwear","pair",2800,.50,["41","42","43"],[BLK,BRN],"color"),
("SH",2,"Suede Slip-On Loafers","Shoes","Kenwood Footwear","pair",2200,.50,["40","42"],[BRN],"color"),
("SN",1,"Everyday Court Sneakers","Sneakers","StrideX","pair",2400,.50,["40","41","42"],[WHT,BLK],"color"),
("SN",2,"Running Mesh Sneakers","Sneakers","StrideX","pair",2900,.50,["41","43"],[GRY],"color"),
("SR",1,"Oxford Cotton Shirt","Shirts","Marvin Tailors","pcs",900,.60,["M","L","XL"],[WHT,BLU],"color"),
("SR",2,"Short Sleeve Linen Shirt","Shirts","Coastline","pcs",850,.60,["M","L"],[BEG],"color"),
("FT",1,"Pleated Formal Trousers","Formal Trousers","Marvin Tailors","pcs",1100,.55,["32","34","36"],[BLK,CHR],"color"),
("FT",2,"Slim Chino Trousers","Formal Trousers","Urban Thread","pcs",1000,.55,["32","34"],[NVY],"color"),
("DR",1,"A-Line Midi Dress","Dresses","Zuri Fashion","pcs",1500,.65,["S","M","L"],[RED,NVY],"color"),
("DR",2,"Floral Wrap Dress","Dresses","Zuri Fashion","pcs",1400,.65,["M","L"],[GRN],"color"),
("SK",1,"Pencil Skirt","Skirts","Zuri Fashion","pcs",800,.60,["S","M","L"],[BLK],"color"),
("MS",1,"Denim Mini Skirt","Mini Skirts","Denimark","pcs",650,.60,["S","M"],[BLU,BLK],"color"),
("TS",1,"Facial Tissue Box","Tissues","SoftTouch","box",55,.40,["100 sheets","200 sheets"],[("2PLY","2-Ply")],"frag"),
("TS",2,"Toilet Tissue Pack","Tissues","SoftTouch","pack",420,.30,["4 rolls","10 rolls"],[("3PLY","3-Ply")],"frag"),
("TS",3,"Pocket Tissue Pack","Tissues","SoftTouch","pack",90,.40,["10 packs"],[("3PLY","3-Ply")],"frag"),
("SP",1,"Room Freshener Spray","Scented Products","Aromaq","bottle",260,.60,["300 ml","500 ml"],[("LAV","Lavender"),("VAN","Vanilla")],"frag"),
("SP",2,"Scented Candle","Scented Products","Aromaq","pcs",310,.60,["200 g"],[("VAN","Vanilla"),("SND","Sandalwood")],"frag"),
("SP",3,"Reed Diffuser","Scented Products","Aromaq","bottle",480,.60,["100 ml"],[("SND","Sandalwood")],"frag"),
("SP",4,"Perfume Eau de Toilette","Scented Products","Aromaq","bottle",1200,.70,["50 ml","100 ml"],[("CIT","Citrus Musk")],"frag"),
]
def slug(s): return s.replace(" ","").replace("-","")
def build():
    out=[];n=0
    for pre,no,name,cat,brand,unit,cost,mk,sizes,cols,mode in P:
        for si,sz in enumerate(sizes):
            for cc,cn in cols:
                n+=1
                f=1+0.6*si if mode=="frag" else 1
                c=round(cost*f); s=round(c*(1+mk)/10)*10 if c>150 else round(c*(1+mk))
                sku=f"{pre}-{no:04d}-{cc}-{slug(sz)}"
                vname=f"{sz} / {cn}" if mode=="color" else (f"{cn} {sz}" if len(cols)>1 or pre=="SP" else sz+" ("+cn+")")
                out.append({"name":name,"psku":f"{pre}-{no:04d}","vsku":sku,"vname":vname,"cat":cat,"brand":brand,"unit":unit,
                    "size":sz,"color":cn if mode=="color" else "","bc":f"TST26{n:08d}","cost":c,"sell":s,
                    "min":random.choice([3,5]) if c>500 else random.choice([20,30]),
                    "stock":random.randint(5,20) if c>500 else random.randint(40,150)})
    return out
def prow(d,**o):
    d={**d,**o}
    return [d["name"],d["psku"],d["vsku"],d["vname"],d["cat"],d["brand"],d["unit"],d["size"],d["color"],d["bc"],d["cost"],d["sell"],d["min"],"Yes"]

HF=Font(name="Arial",bold=True,color="FFFFFF",size=10);HFILL=PatternFill("solid",fgColor="1F3864")
BF=Font(name="Arial",size=10);thin=Side(style="thin",color="BFBFBF");BR=Border(left=thin,right=thin,top=thin,bottom=thin)
def table(ws,cols,rows,widths,text_cols=(),num_cols=(),int_cols=()):
    ws.append(cols)
    for r in rows: ws.append(r)
    for c in ws[1]: c.font=HF;c.fill=HFILL;c.border=BR;c.alignment=Alignment(horizontal="center",vertical="center",wrap_text=True)
    ws.row_dimensions[1].height=30
    for i,w in enumerate(widths,1): ws.column_dimensions[get_column_letter(i)].width=w
    for row in ws.iter_rows(min_row=2,max_row=ws.max_row):
        for c in row:
            c.font=BF;c.border=BR
            if c.column in text_cols: c.number_format="@"
            if c.column in num_cols: c.number_format="#,##0.00"
            if c.column in int_cols: c.number_format="0"
    ws.freeze_panes="A2";ws.auto_filter.ref=f"A1:{get_column_letter(len(cols))}{ws.max_row}"
def text_sheet(ws,rows,w=(26,110)):
    for r in rows: ws.append(r)
    ws.column_dimensions["A"].width=w[0];ws.column_dimensions["B"].width=w[1]
    for row in ws.iter_rows():
        for c in row: c.font=BF;c.alignment=Alignment(wrap_text=True,vertical="top")
    ws["A1"].font=Font(name="Arial",bold=True,size=12)
PW=[34,14,20,24,18,18,8,12,12,16,12,13,11,11]
PT=(2,3,8,9,10)

data=build()
# ---------- Workbook A
wb=Workbook();ws=wb.active;ws.title="START HERE"
text_sheet(ws,[["GOROVIAN POS - Mock products (VALID)"],
 ["Purpose","Synthetic fixture for the shop Excel importer. Use only on a TEST tenant / test database."],
 ["Order","1) Products > Import Excel workbook > 'Products catalogue' (PRODUCTS sheet).  2) Then 'Opening stock' (OPENING STOCK sheet)."],
 ["Barcodes","Synthetic test codes TST26######## - NOT genuine EAN/UPC codes."],
 ["Variants","'Product SKU' = parent (shared by all variants). 'Variant SKU' = unique per sellable variant. Rows sharing a Product SKU become one product with many variants."],
 ["Importer notes","Brand is saved on commit. Unit, Min stock, Track stock are stored on the parent product (first row of each group). This sheet is skipped by the importer."],
 ["Counts",f"{len(data)} variants / {len(P)} parent products / {len(set(p[3] for p in P))} categories."]])
w1=wb.create_sheet("PRODUCTS")
table(w1,PCOLS,[prow(d) for d in data],PW,PT,(11,12),(13,))
w2=wb.create_sheet("OPENING STOCK")
table(w2,["Variant SKU","Quantity"],[[d["vsku"],d["stock"]] for d in data],[24,12],(1,),(),(2,))
wb.active=1
wb.save(os.path.join(HERE,"GOROVIAN_POS_Mock_Products_Valid.xlsx"))

# ---------- Workbook B
V=[data[i] for i in (0,4,9,14,19,26,33,40)]            # 8 controls, distinct parents where possible
V=[d for d in V]
def bad(base_idx,**o):
    d=dict(data[base_idx]); d["vsku"]=f"ZZ-{len(rows_bad)+1:03d}"; d["bc"]=f"TST99{len(rows_bad)+1:08d}"; d["psku"]=f"ZZ-P{len(rows_bad)+1:03d}"
    d.update(o); return d
rows_bad=[]; exp=[]
def add(tid,kind,scenario,expect,**o):
    base=o.pop("base",3); rows_bad.append(bad(base,**o)); exp.append((tid,kind,scenario,expect))
c1=V[0]
add("E01","ERROR","Duplicate variant SKU (same as control V01)","Row rejected: 'Duplicate variant SKU in file (also on row 2)'",vsku=c1["vsku"])
add("E02","ERROR","Duplicate barcode (same as control V02)","Row rejected: 'Duplicate barcode in file (also on row 3)'",bc=V[1]["bc"])
add("E03","ERROR","Negative cost price (-500)","Row rejected: 'Cost price cannot be negative'",cost=-500)
add("E04","ERROR","Negative selling price (-1200)","Row rejected: 'Selling price cannot be negative'",sell=-1200)
add("E05","ERROR","Two defects on one row: duplicate barcode + negative selling price","Row rejected with both messages joined by '; '",bc=V[2]["bc"],sell=-50)
add("E06a","VALID","Original row for the E06 test: Product SKU ZZ-DUPPARENT, no Variant SKU","Accepted (this row is the first use of the Product SKU)",vsku="",psku="ZZ-DUPPARENT")
add("E06","ERROR","Duplicate Product SKU ZZ-DUPPARENT on a row with NO Variant SKU","Row rejected: 'Duplicate product SKU in file (also on row N)'",vsku="",psku="ZZ-DUPPARENT")
add("G01","ERROR","Missing Product name","Row rejected: 'Product name is required'",name="")
add("G02","WARNING","Missing Category","Accepted with warning: category is empty",cat="")
add("G03","ERROR","Selling price is text ('abc')","Row rejected: 'Selling price must be a number'",sell="abc")
add("G04","ERROR","Selling price empty","Row rejected: 'Selling price must be a number'",sell="")
add("G05","WARNING","Variant SKU present but no Size, Color or Variant name","Accepted with warning: saved as Default variant",size="",color="",vname="")
add("G06","ERROR","Negative Min stock (-5)","Row rejected: 'Min stock cannot be negative'",min=-5)
add("G07","ERROR","Cost price is text ('free')","Row rejected: 'Cost price must be a number'",cost="free")

wb=Workbook();ws=wb.active;ws.title="PRODUCTS"
allrows=[prow(d) for d in V]+[prow(d) for d in rows_bad]
table(ws,PCOLS,allrows,PW,PT,(11,12),(13,))
we=wb.create_sheet("EXPECTED RESULTS")
E=[]
for i,d in enumerate(V): E.append([i+2,f"V{i+1:02d}","VALID","Control row",f"Accepted. Variant SKU {d['vsku']}"])
for i,(tid,kind,sc,ex) in enumerate(exp): E.append([len(V)+i+2,tid,kind,sc,ex])
table(we,["Excel row","Test ID","Type","Scenario","Expected importer response"],E,[11,9,9,60,90],(),(),(1,))
for row in we.iter_rows(min_row=2):
    for c in row: c.alignment=Alignment(wrap_text=True,vertical="top")
ws3=wb.create_sheet("OPENING STOCK")
S=[[V[0]["vsku"],10],[V[1]["vsku"],5],["NOPE-0000",8],["",4],[V[2]["vsku"],0],[V[3]["vsku"],-3],[V[4]["vsku"],"ten"]]
table(ws3,["Variant SKU","Quantity"],S,[24,12],(1,))
wt=wb.create_sheet("STOCK EXPECTED")
table(wt,["Excel row","Scenario","Expected importer response"],[
 [2,"Valid SKU, qty 10","Accepted"],[3,"Valid SKU, qty 5","Accepted"],
 [4,"Unknown Variant SKU","Row rejected: 'No matching product/variant - import products first' (requires products imported first)"],
 [5,"No SKU / name at all, qty 4","Row rejected: 'Variant SKU, product SKU, or product name is required'"],
 [6,"Quantity 0","Row rejected: quantity must be greater than zero"],
 [7,"Quantity -3","Row rejected: quantity must be a positive whole number"],
 [8,"Quantity 'ten'","Row rejected: quantity must be a positive whole number"]],[11,50,100],(),(),(1,))
wi=wb.create_sheet("START HERE",0)
text_sheet(wi,[["GOROVIAN POS - Validation test fixture"],
 ["WARNING","Contains deliberately bad rows. TEST tenant only; never import into a live shop."],
 ["Layout","PRODUCTS: 8 valid controls (V01-V08), E01-E06 (rejected), G01/G03/G04/G06/G07 (rejected), G02/G05 (warnings)."],
 ["Batch behaviour","Preview returns valid rows and errors separately. The dialog commits only the valid rows, so partial import works via the UI; the commit API itself rejects the whole batch if ANY submitted row has an error."],
 ["Expected","See EXPECTED RESULTS and STOCK EXPECTED sheets (skipped/ignored by the importer)."]])
wb.active=1
wb.save(os.path.join(HERE,"GOROVIAN_POS_Mock_Products_Validation_Tests.xlsx"))
print(len(data),len(allrows))
