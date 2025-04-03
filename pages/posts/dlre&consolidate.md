---
layout: post
categories: 这学pwn多是一件美逝
title: test——不知哪年的古早笔记杂烩
date: 2025-04-02 15:01:37
---
### dlresolve
```c
_dl_fixup(struct link_map *l, ElfW(Word) reloc_arg){
  //首先通过参数reloca_arg计算入口地址, DT_JMPREL即.rel.plt, reloc_offset 就是 reloc_arg
  const PLTREL *const reloc = (const void *) (D_PTR (l, l_info[DT_JMPREL]) + reloc_offset);
  // 通过reloc->r_info(0x107) 找到.dynsym中对应的条目
   const ElfW(Sym) *sym = &symtab[ELFW(R_SYM) (reloc->r_info)];
  // 检查reloc->r_info的最低位是否为0x7, 不是则退出
  assert (ELFW(R_TYPE)(reloc->r_info) == ELF_MACHINE_JMP_SLOT);
  //接着到strtab + sym->st_name中找到符号字符串, result为libc的基地址
  result = _dl_lookup_symbol_x (strtab + sym->st_name, l, &sym, l->l_scope, version, ELF_RTYPE_CLASS_PLT, flags, NULL);
// value 就是目标函数相对与libc基地址的偏移地址
value = DL_FIXUP_MAKE_VALUE (result, sym ? (LOOKUP_VALUE_ADDRESS (result) + sym->st_value) : 0);
// 写入指定的.got表
return elf_machine_fixup_plt (l, result, refsym, sym, reloc, rel_addr, value);                                       
}
```
```c
typedef struct
{
  Elf32_Word	st_name;		/* Symbol name (string tbl index) */
  Elf32_Addr	st_value;		/* Symbol value */
  Elf32_Word	st_size;		/* Symbol size */
  unsigned char	st_info;		/* Symbol type and binding */
  unsigned char	st_other;		/* Symbol visibility */
  Elf32_Section	st_shndx;		/* Section index */
} Elf32_Sym;
```

#### ？
快慢指针问题：
判断链表是否有环
链表中间节点
### consolidate(整理到unsortedbin)低版本
1. malloc >small bin,且fastbin中有chunk(fast-向后合并->unsorted->small)
    e.g.malloc(p1=0x30);free(p1);malloc(0x500)
2. 切割unsortedchunk,产生last reminder（不整理fastchunk）
3. malloc时如果bin链中没有可以使用的freechunk，并且去切割topchunk，发现topchunk也不够用
4. int_free(),当被free的fastchunk与该chunk相邻的chunk合并后的大小大于FASTBIN_CONSOLIDATION_THRESHOLD时(65536)，调用malloc_consolidate(),fastbin全部合并
malloc_consolidate函数可以将fastbins中能和其它chunk合并的fastchunk进行合并，然后将合并后的碎片进行consolidate

* unlink(fake freed chunk|previnuse=0 chunk)
* 溢出
* 不溢出，consolidate
  * fastchunk移到smallbin，doublefree
* 与unsortedchunk重合

::: warning
*test warning*
tip warning danger info
:::

==Marked text==