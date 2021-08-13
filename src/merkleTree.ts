class JsStorage {
    constructor(public db: { [key: string]: string } = {}) {}

    get(key: string) {
        return this.db[key];
    }

    get_or_element(key: string, defaultElement: string) {
        const element = this.db[key];
        if (element === undefined) {
            return defaultElement;
        } else {
            return element;
        }
    }

    put(key: string, value: string) {
        if (key === undefined || value === undefined) {
            throw Error("key or value is undefined");
        }
        this.db[key] = value;
    }

    del(key: string) {
        delete this.db[key];
    }

    put_batch(key_values: { key: string; value: string }[]) {
        key_values.forEach((element) => {
            this.db[element.key] = element.value;
        });
    }
}

export interface Hasher {
    hash(left: string, right: string): string;
}

interface Handler {
    handle_index(i: number, current_index: number, sibling_index: number): void;
}

export class MerkleTree {
    zero_values: string[];
    public totalElements: number;

    constructor(
        public n_levels: number,
        public prefix: string,
        public hasher: Hasher,
        public storage = new JsStorage()
    ) {
        this.zero_values = [];
        this.totalElements = 0;

        let current_zero_value =
            "21663839004416932945382355908790599225266501822907911457504978515578255421292";
        this.zero_values.push(current_zero_value);
        for (let i = 0; i < n_levels; i++) {
            current_zero_value = this.hasher.hash(
                current_zero_value,
                current_zero_value
            );
            this.zero_values.push(current_zero_value.toString());
        }
    }

    static index_to_key(prefix: string, level: number, index: number) {
        const key = `${prefix}_tree_${level}_${index}`;
        return key;
    }

    async root() {
        let root = await this.storage.get_or_element(
            MerkleTree.index_to_key(this.prefix, this.n_levels, 0),
            this.zero_values[this.n_levels]
        );

        return root;
    }

    async path(index: number) {
        class PathTraverser {
            path_elements: string[];
            path_index: number[];
            constructor(
                public prefix: string,
                public storage: JsStorage,
                public zero_values: string[]
            ) {
                this.path_elements = [];
                this.path_index = [];
            }

            async handle_index(
                level: number,
                element_index: number,
                sibling_index: number
            ) {
                const sibling = await this.storage.get_or_element(
                    MerkleTree.index_to_key(this.prefix, level, sibling_index),
                    this.zero_values[level]
                );
                this.path_elements.push(sibling);
                this.path_index.push(element_index % 2);
            }
        }
        index = Number(index);
        let traverser = new PathTraverser(
            this.prefix,
            this.storage,
            this.zero_values
        );
        const root = await this.storage.get_or_element(
            MerkleTree.index_to_key(this.prefix, this.n_levels, 0),
            this.zero_values[this.n_levels]
        );

        const element = await this.storage.get_or_element(
            MerkleTree.index_to_key(this.prefix, 0, index),
            this.zero_values[0]
        );

        await this.traverse(index, traverser);
        return {
            root,
            path_elements: traverser.path_elements,
            path_index: traverser.path_index,
            element,
        };
    }

    async update(index: number, element: string, insert = false) {
        if (!insert && index >= this.totalElements) {
            throw Error("Use insert method for new elements.");
        } else if (insert && index < this.totalElements) {
            throw Error("Use update method for existing elements.");
        }
        try {
            class UpdateTraverser {
                key_values_to_put: { key: string; value: string }[];
                original_element: string = "";
                constructor(
                    public prefix: string,
                    public storage: JsStorage,
                    public hasher: Hasher,
                    public current_element: string,
                    public zero_values: string[]
                ) {
                    this.key_values_to_put = [];
                }

                async handle_index(
                    level: number,
                    element_index: number,
                    sibling_index: number
                ) {
                    if (level == 0) {
                        this.original_element =
                            await this.storage.get_or_element(
                                MerkleTree.index_to_key(
                                    this.prefix,
                                    level,
                                    element_index
                                ),
                                this.zero_values[level]
                            );
                    }
                    const sibling = await this.storage.get_or_element(
                        MerkleTree.index_to_key(
                            this.prefix,
                            level,
                            sibling_index
                        ),
                        this.zero_values[level]
                    );
                    let left: string, right: string;
                    if (element_index % 2 == 0) {
                        left = this.current_element;
                        right = sibling;
                    } else {
                        left = sibling;
                        right = this.current_element;
                    }

                    this.key_values_to_put.push({
                        key: MerkleTree.index_to_key(
                            this.prefix,
                            level,
                            element_index
                        ),
                        value: this.current_element,
                    });
                    this.current_element = this.hasher.hash(left, right);
                }
            }
            let traverser = new UpdateTraverser(
                this.prefix,
                this.storage,
                this.hasher,
                element,
                this.zero_values
            );

            await this.traverse(index, traverser);
            traverser.key_values_to_put.push({
                key: MerkleTree.index_to_key(this.prefix, this.n_levels, 0),
                value: traverser.current_element,
            });

            await this.storage.put_batch(traverser.key_values_to_put);
        } catch (e) {
            console.error(e);
        }
    }

    async insert(element: string) {
        const index = this.totalElements;
        await this.update(index, element, true);
        this.totalElements++;
    }

    async traverse(index: number, handler: Handler) {
        let current_index = index;
        for (let i = 0; i < this.n_levels; i++) {
            let sibling_index = current_index;
            if (current_index % 2 == 0) {
                sibling_index += 1;
            } else {
                sibling_index -= 1;
            }
            await handler.handle_index(i, current_index, sibling_index);
            current_index = Math.floor(current_index / 2);
        }
    }

    getIndexByElement(element: string) {
        for (let i = this.totalElements - 1; i >= 0; i--) {
            const elementFromTree = this.storage.get(
                MerkleTree.index_to_key(this.prefix, 0, i)
            );
            if (elementFromTree === element) {
                return i;
            }
        }
        return false;
    }
}
