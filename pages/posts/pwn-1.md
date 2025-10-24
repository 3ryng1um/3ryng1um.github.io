---
title: "pwn堆基础 (1)"
date: "2025-10-23T13:57:00.000Z"
slug: "pwn-1"
categories: ["这学pwn多是一件美逝"]
---

## fastbin filo


0x20-0x80  10个


global_max_fast: fastchunk最大范围


#### double free


#### alloc to stack


#### arbitory alloc


## unsortedbin fifo


free后fd bk的值是topchunk保存的地址


挂进链表的时候依次从Unsorted bin的头部向尾部挂，取的时候是从尾部向头部取，fd向尾部指


下一次申请堆块时整理unsorted的chunks（到smal或large）


![145a5bae3a.png](/uploads/pwn-1-1.png)


### 来源

1. 当一个较大的 chunk 被分割成两半后，如果剩下的部分大于 MINSIZE，就会被放到 unsorted bin 中。
2. 释放一个不属于 fastbin 的 chunk，并且该 chunk 不和 top chunk 紧邻时，该 chunk 会被首先放到 unsorted bin 中。关于 top chunk 的解释，请参考下面的介绍。
3. 当进行 malloc_consolidate 时，可能会把合并后的 chunk 放到 unsorted bin 中，如果不是和 top chunk 近邻的话。

### unsortedbinattack（≤2.28）


#### attack的主要流程：


```c
while unsortedbin非空；

victim = unsorted_chunks (av)->bk //vic最后一个
bck = victim->bk;//bck倒数第二个 (unsortedbinattack中，这里是伪造的fake bk）
if(bck->fd != victim)

	
unsorted_chunks (av)->bk = bck;//vic脱链
	bck->fd = unsorted_chunks (av);
```

<details>
<summary>源码：</summary>

```c
for (;; )
    {
      int iters = 0;
      while ((victim = unsorted_chunks (av)->bk) != unsorted_chunks (av))/*******/
        {
          bck = victim->bk;/****************/
          if (__builtin_expect (chunksize_nomask (victim) <= 2 * SIZE_SZ, 0)
              || __builtin_expect (chunksize_nomask (victim)
				   > av->system_mem, 0))
            malloc_printerr ("malloc(): memory corruption");
          size = chunksize (victim);

          if (in_smallbin_range (nb) &&
              bck == unsorted_chunks (av) &&
              victim == av->last_remainder &&
              (unsigned long) (size) > (unsigned long) (nb + MINSIZE))
            {
                  /*。。。。。。。。。。。。。。。*/
            }

          /* remove from unsorted list */
          if (__glibc_unlikely (bck->fd != victim))/*（2.29加入检查）*/
            malloc_printerr ("malloc(): corrupted unsorted chunks 3");
         
 unsorted_chunks (av)->bk = bck;
/*********************/

          bck->fd = unsorted_chunks (av);
          
    
最后把vic返回给用户
```


</details>


![c0f7b54ec6.png](/uploads/pwn-1-2.png)


#### io(≤2.23)


`_IO_FILE`结构中的`_chain`字段对应偏移是0x68，而在`main_arena+88`对应偏移为0x68的地址正好是大小为0x60的small bin的bk，所有我们可以利用其他漏洞修改unsorted bin的size位0x61，所以在将其链入small bin[0x60]之后，就可以实现如下图所示的攻击链


### malloc_consolidate


## smallbin fifo


<400


![Screenshot_2025-10-17-00-36-42-32_8b4425777c77dd003875a0db12c6b4d3.jpg](/uploads/pwn-1-3.jpg)


## largebin 


[[原创]Largebin attack总结-二进制漏洞-看雪-安全社区|安全招聘|kanxue.com](https://bbs.kanxue.com/thread-262424.htm)


![4cfa25234b.png](/uploads/pwn-1-4.png)


（插入时）largebinattack 把堆头写在任意地址里


### 低版本largebinattack：vic>fwd，无检验


P2->bk->fd = stack_var1_addr


P2->bk_nextsize->fd_nextsize = stack_var2_addr


#### **利用条件**

- 可以修改一个large bin chunk的data
- 从unsorted bin中来的large bin chunk要紧跟在被构造过的chunk的后面（free吗？）

### 高版本largebinattack


glib2.30以后，用**vic>fwd**分支


只能实现一个地址的任意地址写


### （取出时）largebin-poisoning / bk_nextsize poisoning


伪造 `bk_nextsize` 为targetaddr，来让 `malloc` 在扫描 large bin 时“找到并 unlink”一个伪造/非预期的 chunk，从而把那个地址当作可分配块返回


```c
/*
         If a large request, scan through the chunks of current bin in
         sorted order to find smallest that fits.  Use the skip list for this.
       */
      if (!in_smallbin_range (nb))//如果不在samllbin大小中
        {
          bin = bin_at (av, idx); //找到申请的size对应的largebin链表
 
          /* skip scan if empty or largest chunk is too small */
          if ((victim = first (bin)) != bin &&                    //此时victim为链表的第一个节点
              (unsigned long) (victim->size) >= (unsigned long) (nb)) //第一步，判断链表的第一个结点，即最大的chunk是否大于要申请的size
            {
                //进入这里时，已经确定链表第一个节点——即最大的chunk大于要申请的size，那么我们就应该从这一条链中取，问题就是取这一条链上的哪一个？
              victim = victim->bk_nextsize; //本来victim是链中最大的那个，现在我们要从小往遍历，那么victim->bk_nextsize就循环回了链中最小的那个
              while (((unsigned long) (size = chunksize (victim)) <
                      (unsigned long) (nb))) //第二步，从最小的chunk开始，反向遍历 chunk size链表，直到找到第一个大于等于所需chunk大小的chunk退出循环
                victim = victim->bk_nextsize;//victim取相邻的更大size的chunk
 
              /* Avoid removing the first entry for a size so that the skip
                 list does not have to be rerouted.  */
              if (victim != last (bin) && victim->size == victim->fd->size) //第三步，申请的chunk对应的chunk存在多个结点，则申请相应堆头的下个结点，不申请堆头。
                victim = victim->fd;            //出现相同大小时堆头作为次优先申请
 
              remainder_size = size - nb;
              unlink (av, victim, bck, fwd); //第四步，largebin unlink 操作
 
              /* Exhaust */
              if (remainder_size < MINSIZE) //第五步，如果剩余的空间小于MINSIZE，则将该空间直接给用户
                {
                  set_inuse_bit_at_offset (victim, size);
                  if (av != &main_arena)
                    victim->size |= NON_MAIN_ARENA;
                }
              /* Split */
              else
                {
                  remainder = chunk_at_offset (victim, nb); //第六步，如果当前剩余空间还可以构成chunk，则将剩余的空间放入到unsorted bin中（切割后）。
 ′。
                  /* We cannot assume the unsorted list is empty and therefore
                     have to perform a complete insert here.  */
                  bck = unsorted_chunks (av);//bck是ub头
                  fwd = bck->fd;                         //fwd是ub第一个chunk
      if (__glibc_unlikely (fwd->bk != bck))
                    {
                      errstr = "malloc(): corrupted unsorted chunks";
                      goto errout;
                    }
                  remainder->bk = bck;
                  remainder->fd = fwd;
                  bck->fd = remainder;
                  fwd->bk = remainder;
                //以上操作完成后lastremainder被插入ub，成为新的链首元素
                //如果不在smallbin范围，那么nextsize指针置空
                  if (!in_smallbin_range (remainder_size))
                    {
                      remainder->fd_nextsize = NULL;
                      remainder->bk_nextsize = NULL;
                    }
 
                  set_head (victim, nb | PREV_INUSE |
                            (av != &main_arena ? NON_MAIN_ARENA : 0));
                  set_head (remainder, remainder_size | PREV_INUSE);
                  set_foot (remainder, remainder_size);
                }
              check_malloced_chunk (av, victim, nb);
              void *p = chunk2mem (victim);
              alloc_perturb (p, bytes);
              return p;
            }
        }
```


![image.png](/uploads/pwn-1-5.png)


victim rdx（小的那个）


![image.png](/uploads/pwn-1-6.png)


## tcachebin filo


<0x420


```c
typedef struct tcache_perthread_struct
{
uint16_t counts[TCACHE_MAX_BINS];

tcache_entry *entries[TCACHE_MAX_BINS];/*最后进入的堆块地址*/

} tcache_perthread_struct;
```


![image.png](/uploads/pwn-1-7.png)


#### key：


### 高版本绕过tcachekey检测：


没办法泄露时


[https://xz.aliyun.com/news/14932?time__1311=eqUxuDBD0AGQitD8KD%2FWnbjOzG8Srror74D&u_atoken=8b57e8668ff22ef52210202fe1e57713&u_asig=1a0c39d417423955430176303e003a](https://xz.aliyun.com/news/14932?time__1311=eqUxuDBD0AGQitD8KD%2FWnbjOzG8Srror74D&u_atoken=8b57e8668ff22ef52210202fe1e57713&u_asig=1a0c39d417423955430176303e003a)


tcache double-free漏洞的key机制，2种绕过方式：

1. 修改key达到绕过检测
2. 无法修改key，但是修改堆快大小，通过换个链表来绕过检测
3. botcake：+uaf

    ![image.png](/uploads/pwn-1-8.png)


‍


### tcache house of spirit


任意地址free


tcache_put在free的时候没有检查被释放的指针是否真的是堆块的malloc指针


### tcache poisoning


（伪造得当的话）任意地址申请


覆盖tcache中的next成员变量(fd)


由于tcache_get()函数没有对next进行检查


高版本需计算


### ***tcache stashing unlink（calloc）**


tcache2free劫持perhreadstruct泄露libc是？？？


[https://blog.csdn.net/Mr_Fmnwon/article/details/142649778](https://blog.csdn.net/Mr_Fmnwon/article/details/142649778)


#### 作用：


任意地址(fake chunk)分配chunk 


or 任意地址上写一个libc（smallbin）地址（这有啥用）


原理：


calloc分配堆块时不从tcache bin中选取


条件：


![4db04c60-c6b3-4b88-ae7c-f93ee2b29193.png](/uploads/pwn-1-9.png)


calloc后如果tcachebin中有空闲位置（>0 <TCACHE_MAX_BINS）,会将剩余的smallbin挂进tcache中，在这个过程中没有正常unlink的检查（这里alloc c1，只检查c2的完整性（应该是））


**fake chunk 的 bk 指向一个能够写的合法区域**


申请fakechunk要用malloc


过程：


布置smallbin ←（不连续的块）放入unsortedbin


tcache空出两个位置


calloc，剩余smallchunk倒灌进tcache2个


最终tcache头部为fakechunk


![image.png](/uploads/pwn-1-10.png)


最终：


![image.png](/uploads/pwn-1-11.png)


### tcache perthread corruption


leak heap，然后劫持tcache_perthread_struct


更改count


将tcache大小的堆块放入unsortedbin或其他bin


或改写堆头地址


### **fastbin_reverse_into_tcache**


### **Unsortbin 2 Tcachebin**


配合**Off By One**或**Off By NULL**的漏洞，使**Unsortbin**在合并过程中将中间的**Tcachebin**合并，从而达到修改**fd**字段的效果


uaf


    →double free


        →溢出读写(free的)堆块d


### libc_main_start

start→libcmainstart


csu


main


exit


## topchunk


## main_arena


```bash
$1 = (malloc_state *) 0x7e4f479c3b20 <main_arena>
pwndbg> p main_arena
$2 = {
  mutex = 0,
  flags = 0,
  fastbinsY = {0x0, 0x5a0974f08230, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0},
  top = 0x5a0974f08370,
  last_remainder = 0x0,
  bins = {0x5a0974f08010, 0x5a0974f08010, 0x7e4f479c3b88 <main_arena+104>,
    0x7e4f479c3b88 <main_arena+104>, 
	    .......................
        0x7e4f479c41a8 <main_arena+1672>...},
  binmap = {0, 0, 0, 0},
  next = 0x7e4f479c3b20 <main_arena>,
  next_free = 0x0,
  attached_threads = 1,
  system_mem = 139264,
  max_system_mem = 139264
}
```


bins的第一对是unsortedbin？第2个随unsortedbin的堆头bk指向的地址而变动，第1个是？


### bins


`bins` 的第 1 个有效 bin 是 **unsorted bin**，之后是 small bins、large bins。


`bins` 在实现上是按 **每个 bin 用两项（成对）存储** 的（对应双向循环链表的 `fd` / `bk`）


如果unsortedbin里没有东西，这里就指向topchunk存放的地址


![image.png](/uploads/pwn-1-12.png)


后面的是largrbin


## 基本技巧


### orange（no free）


### （no show）


### unlink


no pie(+full relo)


最好是堆溢出/offbyone


### offbyone(large)


### off by null


### 爆破：


或者封装起来：


```c++
while True:
    try:
        io = process(elf.path)
        exp()
        log.success('Dragon defeated successfully!')
        io.interactive()  # Keep the interaction open after the attack
        break
    except:
        # log.error('EOFError encountered, retrying...')
        io.close()  # Restart the process if an error occurs
```


调试时关闭pie：


在fd和bk位留下 main_arena+96


在fd_n bk_n留下地址

