/**
 * GEDCOM fixtures for the reader tests.
 *
 * No real MacFamilyTree export ships in `docs/reference`, so these are
 * hand-written but shaped like a real small tree: three people over two
 * generations, one family, a source with a repository, a shared note, and a
 * media object. Each fixture carries a few non-standard sub-tags (`_CUSTOM`,
 * `_MYTAG`) so a test can prove they survive in `raw_gedcom`.
 */

/** GEDCOM 5.5.1 — the format the writer emits and MacFamilyTree reads best. */
export const GEDCOM_551 = `0 HEAD
1 SOUR MacFamilyTree
2 VERS 10.4
2 NAME MacFamilyTree
1 GEDC
2 VERS 5.5.1
2 FORM LINEAGE-LINKED
1 CHAR UTF-8
1 COPR (c) 2024 Smith Family
1 SUBM @U1@
0 @I1@ INDI
1 NAME John Fitzgerald /Smith/
2 GIVN John Fitzgerald
2 SURN Smith
2 NICK Jack
1 NAME John /Smyth/
2 TYPE aka
1 SEX M
1 BIRT
2 DATE 12 MAR 1820
2 PLAC Boston, Suffolk, Massachusetts, USA
2 _MYTAG keep me
1 DEAT
2 DATE 4 JUL 1890
2 PLAC Boston, Suffolk, Massachusetts, USA
2 CAUS Old age
1 OCCU Blacksmith
2 DATE FROM 1840 TO 1885
1 RESI
2 DATE 1860
2 PLAC Boston, Suffolk, Massachusetts, USA
1 REFN SMITH-001
1 _FSFTID LZ99-ABC
1 NOTE @N1@
1 SOUR @S1@
2 PAGE p. 42
2 QUAY 3
1 OBJE @O1@
2 _PRIM Y
1 _CUSTOM private field
0 @I2@ INDI
1 NAME Mary /Jones/
2 TYPE maiden
1 SEX F
1 BIRT
2 DATE ABT 1825
1 DEAT
2 DATE 1888
0 @I3@ INDI
1 NAME William /Smith/
1 SEX M
1 BIRT
2 DATE 2 FEB 1850
2 PLAC New York, New York, USA
1 FAMC @F1@
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 CHIL @I3@
2 _FREL Natural
2 _MREL Natural
1 MARR
2 DATE 5 JUN 1845
2 PLAC Boston, Suffolk, Massachusetts, USA
1 _STATUS Married
0 @S1@ SOUR
1 TITL Massachusetts Vital Records
1 AUTH Commonwealth of Massachusetts
1 PUBL Boston, 1901
1 REPO @R1@
1 _APID 1,2:3
0 @R1@ REPO
1 NAME Boston Public Library
1 ADDR 700 Boylston St
2 CITY Boston
2 CTRY USA
1 PHON 617-555-0100
1 PHON 617-555-0199
1 WWW https://www.bpl.org
0 @N1@ NOTE
1 CONT This family emigrated from Ireland in the 1840s.
0 @O1@ OBJE
1 FILE john-smith-portrait.jpg
1 FORM jpeg
1 TITL John Smith, c. 1875
0 @U1@ SUBM
1 NAME Josh D
0 TRLR
`;

/** GEDCOM 7.0 — leading calendar keywords, `image/*` media form, inline notes. */
export const GEDCOM_70 = `0 HEAD
1 GEDC
2 VERS 7.0
1 SOUR Ancestry
2 VERS 2024
0 @I1@ INDI
1 NAME Jane /Doe/
2 TYPE BIRTH
2 GIVN Jane
2 SURN Doe
1 SEX F
1 BIRT
2 DATE 1 JAN 1900
2 PLAC London, England
1 DEAT
2 DATE JULIAN 14 FEB 1750
1 NOTE She kept a detailed diary.
1 SOUR @S1@
2 PAGE image 12
2 QUAY 2
1 OBJE @O1@
1 _NEW custom seven-oh tag
0 @I2@ INDI
1 NAME John /Doe/
1 SEX M
0 @F1@ FAM
1 HUSB @I2@
1 WIFE @I1@
1 MARR
2 DATE 1925
0 @S1@ SOUR
1 TITL England Births and Christenings
0 @O1@ OBJE
1 FILE https://example.com/media/jane.jpg
2 FORM image/jpeg
2 TITL Jane Doe
0 TRLR
`;

/** Just a header and trailer — an empty but valid file. */
export const GEDCOM_EMPTY = `0 HEAD
1 GEDC
2 VERS 5.5.1
0 TRLR
`;
